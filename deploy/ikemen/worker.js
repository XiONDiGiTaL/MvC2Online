// Serves the Ikemen GO browser shell from static assets, and streams the big
// files (content.zip, ikemen.wasm) out of R2 with real byte-range support.
//
// The range support is the whole point: the client boots by asking for the
// last 64 KB of content.zip to read its central directory, then range-fetches
// one fighter's sprites the first time that fighter is picked. A plain static
// host returns 200 with the whole 1.75 GB and the lazy mount gives up.
//
// content.zip is stored as fixed-size chunks (content.zip.0, .1, ...) because
// wrangler refuses single uploads over 300 MiB. The Worker stitches a read
// that crosses a chunk boundary into one response, so the archive still looks
// like a single continuous object to the client. content.zip.meta carries the
// total size and chunk size, and is uploaded last so ranges never resolve
// against a half-uploaded archive.

const WASM_KEY = { key: "ikemen.wasm", type: "application/wasm" };
const META_KEY = "content.zip.meta";
const DEFAULT_CHUNK = 256 * 1024 * 1024;

// Cached per isolate: the archive only changes on redeploy, and each uncached
// read costs an R2 operation.
let metaCache = null;

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or malformed: fall back to a full body
  const [, startRaw, endRaw] = m;
  if (startRaw === "" && endRaw === "") return null;

  // Suffix form: "bytes=-N" means the last N bytes.
  if (startRaw === "") {
    const n = Number(endRaw);
    if (!Number.isFinite(n) || n <= 0) return null;
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }

  const offset = Number(startRaw);
  if (offset >= size) return { unsatisfiable: true };
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (end < offset) return { unsatisfiable: true };
  return { offset, length: end - offset + 1 };
}

// Reads `length` bytes at `offset` across chunk objects, pulling lazily so a
// client that aborts mid-fighter stops the remaining R2 reads.
function readSpan(env, offset, length, chunkSize) {
  let pos = offset;
  let remaining = length;
  let reader = null;

  return new ReadableStream({
    async pull(controller) {
      try {
        if (!reader) {
          if (remaining <= 0) return controller.close();
          const index = Math.floor(pos / chunkSize);
          const inChunk = pos - index * chunkSize;
          const take = Math.min(remaining, chunkSize - inChunk);
          const obj = await env.CONTENT.get(`${META_KEY.replace(".meta", "")}.${index}`, {
            range: { offset: inChunk, length: take },
          });
          if (!obj) {
            return controller.error(new Error(`missing content.zip.${index}`));
          }
          reader = obj.body.getReader();
          pos += take;
          remaining -= take;
        }

        const { done, value } = await reader.read();
        if (done) {
          reader = null;
          if (remaining <= 0) return controller.close();
          return this.pull(controller);
        }
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      if (reader) reader.cancel(reason);
    },
  });
}

async function loadMeta(env) {
  if (metaCache) return metaCache;
  const obj = await env.CONTENT.get(META_KEY);
  if (!obj) return null;
  let info;
  try {
    info = JSON.parse(await obj.text());
  } catch {
    return null;
  }
  if (!Number.isFinite(info.size) || !Number.isFinite(info.chunk)) return null;
  metaCache = {
    size: info.size,
    chunk: info.chunk || DEFAULT_CHUNK,
    etag: obj.httpEtag,
  };
  return metaCache;
}

async function serveZip(request, env) {
  const meta = await loadMeta(env);
  if (!meta) {
    return new Response("content.zip has not been uploaded yet", { status: 404 });
  }

  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=60",
    "content-type": "application/zip",
    "etag": meta.etag,
  };

  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  // If-Range is a build validator: a mismatch means the client holds offsets
  // from a previous pack, so it gets the full new body instead of stale bytes.
  const usable = rangeHeader && (!ifRange || ifRange === meta.etag);
  const range = usable ? parseRange(rangeHeader, meta.size) : null;

  if (range && range.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${meta.size}` },
    });
  }

  const offset = range ? range.offset : 0;
  const length = range ? range.length : meta.size;
  const status = range ? 206 : 200;
  const headers = { ...baseHeaders, "content-length": String(length) };
  if (range) {
    headers["content-range"] = `bytes ${offset}-${offset + length - 1}/${meta.size}`;
  }

  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }
  return new Response(readSpan(env, offset, length, meta.chunk), { status, headers });
}

async function serveWasm(request, env) {
  const head = await env.CONTENT.head(WASM_KEY.key);
  if (!head) {
    return new Response("missing R2 object: ikemen.wasm", { status: 404 });
  }

  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=3600",
    "content-type": WASM_KEY.type,
    "etag": head.httpEtag,
  };

  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const usable = rangeHeader && (!ifRange || ifRange === head.httpEtag);
  const range = usable ? parseRange(rangeHeader, head.size) : null;

  if (range && range.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${head.size}` },
    });
  }

  const offset = range ? range.offset : 0;
  const length = range ? range.length : head.size;
  const status = range ? 206 : 200;
  const headers = { ...baseHeaders, "content-length": String(length) };
  if (range) {
    headers["content-range"] = `bytes ${offset}-${offset + length - 1}/${head.size}`;
  }
  if (request.method === "HEAD") {
    return new Response(null, { status, headers });
  }

  const obj = await env.CONTENT.get(WASM_KEY.key, {
    range: { offset, length },
  });
  if (!obj) {
    return new Response("missing R2 object: ikemen.wasm", { status: 404 });
  }
  return new Response(obj.body, { status, headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/content.zip" || pathname === "/ikemen.wasm") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      return pathname === "/content.zip"
        ? serveZip(request, env)
        : serveWasm(request, env);
    }

    // Everything else is the shell itself (html, js, icons).
    return env.ASSETS.fetch(request);
  },
};
