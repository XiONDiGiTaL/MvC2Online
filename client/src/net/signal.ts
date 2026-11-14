// Signaling client. Rooms live on the small Node server in /server; this file
// only does membership + relay. Gameplay never goes through it.

export interface RoomPlayer {
  id: string;
  name: string;
  role: "host" | "guest";
  ready: boolean;
  connected: boolean;
}

export interface RoomState {
  code: string;
  host: RoomPlayer | null;
  guest: RoomPlayer | null;
  settings: Record<string, unknown>;
  phase: "lobby" | "select" | "match";
  startedAt?: number;
}

export type SignalMessage =
  | { t: "welcome"; id: string }
  | { t: "created"; code: string; selfId: string; room: RoomState }
  | { t: "joined"; code: string; selfId: string; room: RoomState }
  | { t: "room"; room: RoomState }
  | { t: "signal"; from: string; data: unknown }
  | { t: "peer-left"; id: string; name: string }
  | { t: "error"; code: string; message: string }
  | { t: "chat"; from: string; text: string }
  | { t: "pong"; n: number };

export interface SignalOptions {
  url: string;
  name: string;
}

const DEFAULT_LOCAL = "ws://127.0.0.1:8787";

/** Resolve the signaling endpoint.
 *  1. ?signal=wss://... query override
 *  2. /config.json { signalUrl }
 *  3. same origin when the server hosts the client
 *  4. local dev default
 */
let overrideUrl = "";

/** Set from Settings; an explicit user choice always wins. */
export function setSignalOverride(url: string) {
  overrideUrl = url.trim();
}

export async function resolveSignalUrl(): Promise<string> {
  const q = new URLSearchParams(location.search).get("signal");
  if (q) return q;
  if (overrideUrl) return overrideUrl;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (res.ok) {
      const cfg = (await res.json()) as { signalUrl?: string };
      if (cfg.signalUrl && cfg.signalUrl.length > 0) return cfg.signalUrl;
    }
  } catch {
    /* config.json is optional */
  }
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return DEFAULT_LOCAL;
  }
  // Same-origin websocket (server also serving the built client)
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
}

type Handler = (m: SignalMessage) => void;

/** Both transports (WebSocket server, Supabase Realtime) satisfy this. */
export interface SignalLike {
  selfId: string;
  name: string;
  latencyMs: number;
  connect(): Promise<void>;
  onMessage(h: Handler): () => void;
  send(obj: unknown): void;
  close(): void;
}

export class SignalClient implements SignalLike {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: unknown[] = [];
  private pingTimer: number | null = null;
  private pingSent = 0;
  latencyMs = 0;
  selfId = "";
  name: string;
  url: string;
  closed = false;

  constructor(opts: SignalOptions) {
    this.url = opts.url;
    this.name = opts.name;
  }

  onMessage(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private emit(m: SignalMessage) {
    for (const h of this.handlers) {
      try {
        h(m);
      } catch (err) {
        console.error("[signal] handler threw", err);
      }
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(new Error(`Could not open signaling socket to ${this.url}`));
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`Signaling server did not answer at ${this.url}`));
        }
      }, 8000);

      ws.onopen = () => {
        this.flush();
        this.send({ t: "hello", name: this.name });
        if (this.pingTimer === null) {
          this.pingTimer = window.setInterval(() => {
            this.pingSent = performance.now();
            this.send({ t: "ping", n: this.pingSent });
          }, 4000);
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(
            `Could not reach the signaling server at ${this.url}. ` +
              `Start it locally with "npm run server" or set the signal URL in Settings.`
          ));
        }
      };
      ws.onclose = () => {
        this.closed = true;
        if (this.pingTimer !== null) {
          window.clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(`Signaling connection closed unexpectedly (${this.url})`));
        }
        this.emit({ t: "error", code: "closed", message: "Connection to the server was lost." });
      };
      ws.onmessage = (ev) => {
        let msg: SignalMessage;
        try {
          msg = JSON.parse(String(ev.data)) as SignalMessage;
        } catch {
          return;
        }
        if (msg.t === "pong") {
          this.latencyMs = Math.max(0, Math.round(performance.now() - msg.n));
          return;
        }
        if (msg.t === "welcome") this.selfId = msg.id;
        if ((msg.t === "created" || msg.t === "joined") && msg.selfId) this.selfId = msg.selfId;
        this.emit(msg);
      };
    });
  }

  send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    } else {
      this.queue.push(obj);
    }
  }

  private flush() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    }
  }

  close() {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
