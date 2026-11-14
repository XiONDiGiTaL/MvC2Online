// MvC2Online signaling + relay server.
//
// Responsibilities (and nothing more):
//   * WebSocket room membership with 4-character codes
//   * relay of WebRTC offer/answer/ICE between the two room members
//   * authoritative room metadata broadcast (host owns the payload)
// Gameplay inputs travel peer-to-peer over the WebRTC data channel.
//
// Optionally serves the built client from ./dist so a single service can host
// both (handy on Railway). GitHub Pages users can ignore that part.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";

// PaaS providers inject PORT; an empty string must not become port 0.
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34679";
const rooms = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function code() {
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return rooms.has(out) ? code() : out;
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function roomView(room) {
  return {
    code: room.code,
    host: room.host ? pub(room.host) : null,
    guest: room.guest ? pub(room.guest) : null,
    settings: room.settings ?? {},
    phase: room.phase ?? "lobby",
    meta: room.meta ?? {},
  };
}

function pub(client) {
  return {
    id: client.id,
    name: client.name,
    role: client.role,
    ready: client.ready,
    connected: true,
  };
}

function broadcast(room, obj, exceptId = null) {
  for (const c of [room.host, room.guest]) {
    if (!c || c.id === exceptId) continue;
    send(c.ws, obj);
  }
}

function leave(ws) {
  const id = ws.clientId;
  if (!id) return;
  for (const [roomCode, room] of rooms) {
    const isHost = room.host?.id === id;
    const isGuest = room.guest?.id === id;
    if (!isHost && !isGuest) continue;
    const leftName = (isHost ? room.host : room.guest)?.name ?? "Peer";
    if (isHost) {
      // Host leaving ends the room.
      if (room.guest) {
        send(room.guest.ws, {
          t: "error",
          code: "host-left",
          message: "The host left the room.",
        });
        room.guest.ws.clientId = null;
      }
      rooms.delete(roomCode);
    } else {
      room.guest = null;
      if (room.host) {
        broadcast(room, { t: "peer-left", id, name: leftName });
        room.host.ready = false;
        send(room.host.ws, { t: "room", room: roomView(room) });
      }
    }
    break;
  }
  ws.clientId = null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health" || url.pathname.endsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
    return;
  }

  // static hosting of the built client (optional)
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/MvC2Online/")) pathname = pathname.slice("/MvC2Online".length);
  if (pathname === "/" || pathname === "" || pathname === "/MvC2Online") pathname = "/index.html";
  const safe = normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = join(DIST, safe);
  if (!filePath.startsWith(DIST + sep) && filePath !== DIST) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) throw new Error("dir");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=600",
    });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("MvC2Online signaling server is running. Client build not found (run npm run build).");
    }
  }
});

const wss = new WebSocketServer({ server, path: undefined, maxPayload: 256 * 1024 });

wss.on("connection", (ws) => {
  ws.id = randomUUID();
  ws.name = "Player";
  ws.ready = false;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  send(ws, { t: "welcome", id: ws.id });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== "string") return;

    if (msg.t === "ping") {
      send(ws, { t: "pong", n: msg.n });
      return;
    }
    if (msg.t === "hello") {
      ws.name = String(msg.name ?? "Player").slice(0, 24) || "Player";
      return;
    }

    if (msg.t === "create") {
      leave(ws);
      ws.name = String(msg.name ?? ws.name).slice(0, 24) || "Player";
      const room = {
        code: code(),
        host: { id: ws.id, name: ws.name, role: "host", ready: false, ws },
        guest: null,
        settings: msg.settings ?? {},
        phase: "lobby",
        meta: {},
        createdAt: Date.now(),
      };
      rooms.set(room.code, room);
      ws.clientId = ws.id;
      send(ws, { t: "created", code: room.code, selfId: ws.id, room: roomView(room) });
      return;
    }

    if (msg.t === "join") {
      const roomCode = String(msg.code ?? "").toUpperCase().trim();
      const room = rooms.get(roomCode);
      if (!room) {
        send(ws, { t: "error", code: "no-room", message: `No room with code ${roomCode}.` });
        return;
      }
      if (room.guest && room.guest.id !== ws.id) {
        send(ws, { t: "error", code: "full", message: "That room already has two players." });
        return;
      }
      leave(ws);
      ws.name = String(msg.name ?? ws.name).slice(0, 24) || "Guest";
      room.guest = { id: ws.id, name: ws.name, role: "guest", ready: false, ws };
      room.phase = "lobby";
      ws.clientId = ws.id;
      send(ws, { t: "joined", code: room.code, selfId: ws.id, room: roomView(room) });
      broadcast(room, { t: "room", room: roomView(room) });
      return;
    }

    // authenticated by socket id
    const room = [...rooms.values()].find(
      (r) => r.host?.id === ws.clientId || r.guest?.id === ws.clientId
    );
    if (!room) {
      send(ws, { t: "error", code: "no-room", message: "You are not in a room." });
      return;
    }

    if (msg.t === "signal") {
      const other = room.host?.id === ws.clientId ? room.guest : room.host;
      if (other) send(other.ws, { t: "signal", from: ws.clientId, data: msg.data });
      return;
    }

    if (msg.t === "room-set") {
      if (room.host?.id !== ws.clientId) return; // host is authoritative
      if (msg.room?.settings) room.settings = msg.room.settings;
      if (msg.room?.phase) room.phase = msg.room.phase;
      if (msg.room?.meta) room.meta = msg.room.meta;
      if (typeof msg.room?.hostReady === "boolean") room.host.ready = msg.room.hostReady;
      if (room.guest && typeof msg.room?.guestReady === "boolean") {
        room.guest.ready = msg.room.guestReady;
      }
      broadcast(room, { t: "room", room: roomView(room) });
      return;
    }

    if (msg.t === "ready") {
      const me = room.host?.id === ws.clientId ? room.host : room.guest;
      if (me) me.ready = !!msg.ready;
      broadcast(room, { t: "room", room: roomView(room) });
      return;
    }

    if (msg.t === "leave") {
      leave(ws);
      send(ws, { t: "left" });
      return;
    }
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      leave(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, HOST, () => {
  console.log(`[mvc2online] signaling listening on http://${HOST}:${PORT}`);
  console.log(`[mvc2online] health: http://127.0.0.1:${PORT}/health`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
