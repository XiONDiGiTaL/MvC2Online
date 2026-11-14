// Serves the Ikemen GO browser shell from static assets, and streams the two
// large files (content.zip, ikemen.wasm) out of R2 with real byte-range
// support.
//
// The range support is the whole point: the client boots by asking for the
// last 64 KB of content.zip to read its central directory, then range-fetches
// one fighter's sprites the first time that fighter is picked. A plain static
// host returns 200 with the whole 1.8 GB and the lazy mount gives up.

const KEYS = {
  "/content.zip": { key: "content.zip", type: "application/zip" },
  "/ikemen.wasm": { key: "ikemen.wasm", type: "application/wasm" },
};

const INDEX_TAIL = 64 * 1024;

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

async function serveObject(request, env, { key, type }) {
  const head = await env.CONTENT.head(key);
  if (!head) {
    return new Response(`missing R2 object: ${key}`, { status: 404 });
  }

  const etag = head.httpEtag;
  const baseHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=60",
    "content-type": type,
    "etag": etag,
  };

  const rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  // If-Range is a validator: a mismatch means the client's cached copy is from
  // a different build, so it must get the full new body rather than stale
  // byte offsets.
  const rangeUsable = rangeHeader && (!ifRange || ifRange === etag);
  const range = rangeUsable ? parseRange(rangeHeader, head.size) : null;

  if (!range) {
    if (request.method === "HEAD") {
      return new Response(null, {
        headers: { ...baseHeaders, "content-length": String(head.size) },
      });
    }
    const obj = await env.CONTENT.get(key);
    if (!obj) return new Response(`missing R2 object: ${key}`, { status: 404 });
    return new Response(obj.body, {
      headers: { ...baseHeaders, "content-length": String(head.size) },
    });
  }

  if (range.unsatisfiable) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${head.size}` },
    });
  }

  const obj = await env.CONTENT.get(key, {
    range: { offset: range.offset, length: range.length },
  });
  if (!obj) return new Response(`missing R2 object: ${key}`, { status: 404 });

  const end = range.offset + range.length - 1;
  return new Response(request.method === "HEAD" ? null : obj.body, {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(range.length),
      "content-range": `bytes ${range.offset}-${end}/${head.size}`,
    },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    const object = KEYS[pathname];
    if (object) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("method not allowed", { status: 405 });
      }
      return serveObject(request, env, object);
    }

    // Everything else is the shell itself (html, js, icons).
    return env.ASSETS.fetch(request);
  },
};
