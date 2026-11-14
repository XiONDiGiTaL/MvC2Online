// Signaling over Supabase Realtime (Phoenix channels) instead of a bespoke
// Node server. Gameplay still runs peer-to-peer over the WebRTC data channel;
// this carries only membership, SDP/ICE and room metadata.
//
// It speaks the same application messages as the WebSocket server in /server
// (create, join, signal, room-set, ready, leave), so the online UI does not
// care which transport is in use.
//
// Seats are explicit: the creator is the host and owns the room, and the host's
// room broadcast tells the guest who the host is. Nothing infers roles from
// message ordering. Only a publishable/anon key belongs here.

import type { RoomState, SignalLike, SignalMessage } from "./signal";

const HEARTBEAT_MS = 25_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_PREFIX = "mvc2:";
const JOIN_GRACE_MS = 3500;

export interface RealtimeConfig {
  /** project base url, e.g. https://abcdefgh.supabase.co */
  url: string;
  /** publishable/anon key */
  key: string;
}

export async function loadRealtimeConfig(): Promise<RealtimeConfig | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const cfg = (await res.json()) as { realtime?: Partial<RealtimeConfig> };
    const rt = cfg.realtime;
    if (rt && typeof rt.url === "string" && rt.url && typeof rt.key === "string" && rt.key) {
      return { url: rt.url, key: rt.key };
    }
  } catch {
    /* config.json is optional */
  }
  return null;
}

export function makeRoomCode(len = 4): string {
  let out = "";
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

export function makeId(): string {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return buf[0].toString(36) + buf[1].toString(36);
}

type Handler = (m: SignalMessage) => void;

interface Seat {
  name: string;
  ready: boolean;
}

export class RealtimeSignal implements SignalLike {
  selfId = makeId();
  name: string;
  latencyMs = 0;
  closed = false;
  url = "realtime";
  roomCode = "";

  private cfg: RealtimeConfig;
  private ws: WebSocket | null = null;
  private topic = "";
  private ref = 0;
  private handlers = new Set<Handler>();
  private seats = new Map<string, Seat>();
  private hostId = "";
  private meta: Record<string, unknown> | null = null;
  private phase: "lobby" | "select" | "match" = "lobby";
  private settings: Record<string, unknown> = { stage: 0, timer: 99 };
  private heartbeat: number | null = null;
  private isHost = false;
  private joinTimer: number | null = null;
  private sawHost = false;
  private queued = false;
  private paired = false;
  private hostTimer: number | null = null;
  private replies: string[] = [];
  private queueMode = "casual";

  constructor(cfg: RealtimeConfig, name: string) {
    this.cfg = cfg;
    this.name = name || "Player";
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
        console.error("[rt-signal] handler threw", err);
      }
    }
  }

  /** Opens the socket. Channels are joined by create()/join(). */
  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    const endpoint =
      `${this.cfg.url.replace(/^http/, "ws")}/realtime/v1/websocket` +
      `?apikey=${encodeURIComponent(this.cfg.key)}&vsn=1.0.0`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(endpoint);
      } catch {
        reject(new Error("Could not open the realtime connection."));
        return;
      }
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Realtime connection timed out."));
        }
      }, 9000);

      ws.onopen = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
        if (this.heartbeat === null) {
          this.heartbeat = window.setInterval(() => {
            this.raw({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.nextRef() });
          }, HEARTBEAT_MS);
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error("Could not reach the realtime service."));
        }
      };
      ws.onclose = () => {
        this.closed = true;
        if (this.heartbeat !== null) {
          window.clearInterval(this.heartbeat);
          this.heartbeat = null;
        }
        this.emit({ t: "error", code: "closed", message: "Realtime connection lost." });
      };
      ws.onmessage = (ev) => {
        let msg: { event?: string; ref?: string; payload?: any; topic?: string };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        this.receive(msg);
      };
    });
  }

  private nextRef() {
    this.ref += 1;
    return String(this.ref);
  }

  private raw(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private broadcast(event: string, payload: unknown) {
    this.raw({
      topic: this.topic,
      event: "broadcast",
      payload: { type: "broadcast", event, payload },
      ref: this.nextRef(),
    });
  }

  private trackPresence() {
    this.raw({
      topic: this.topic,
      event: "presence",
      payload: {
        type: "presence",
        event: "track",
        payload: { name: this.name, role: this.isHost ? "host" : "guest" },
      },
      ref: this.nextRef(),
    });
  }

  private pendingJoin: (() => void) | null = null;
  private pendingJoinRef: string | null = null;

  private joinChannel(code: string): Promise<void> {
    return this.openChannel(`realtime:${ROOM_PREFIX}${code}`, code);
  }

  /** Matchmaking inbox: presence tells us who else is searching. */
  private joinQueue(mode: string): Promise<void> {
    this.queued = true;
    this.paired = false;
    this.queueMode = mode;
    return this.openChannel(`realtime:mvc2:queue:${mode}`, "");
  }

  private openChannel(fullTopic: string, code: string): Promise<void> {
    // Leaving the previous topic is what removes our presence from it. Without
    // this, a player who paired or moved to a room stayed visible in the queue
    // as a ghost and blocked everyone behind them from ever matching.
    if (this.topic && this.topic !== fullTopic) {
      this.raw({ topic: this.topic, event: "phx_leave", payload: {}, ref: this.nextRef() });
      this.seats.clear();
    }
    this.roomCode = code;
    this.topic = fullTopic;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("The room did not open in time."));
        }
      }, 9000);
      const joinRef = this.nextRef();
      this.pendingJoinRef = joinRef;
      this.pendingJoin = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.trackPresence();
        resolve();
      };
      this.raw({
        topic: this.topic,
        event: "phx_join",
        payload: { config: { broadcast: { self: false }, presence: { key: this.selfId } } },
        ref: joinRef,
      });
    });
  }

  private receive(msg: { event?: string; ref?: string; payload?: any; topic?: string }) {
    const ev = msg.event;
    const p = msg.payload;

    if (ev === "phx_reply") {
      // Presence acks share this event; only the join's own ref may resolve it.
      const sameRef = String(msg.ref ?? "") === String(this.pendingJoinRef ?? "");
      if (p?.status === "ok" && this.pendingJoin && sameRef) {
        const fire = this.pendingJoin;
        this.pendingJoin = null;
        this.pendingJoinRef = null;
        fire();
      } else if (p?.status && p.status !== "ok" && this.pendingJoin && sameRef) {
        this.emit({
          t: "error",
          code: "rejected",
          message: p?.response?.reason ? String(p.response.reason) : "The room rejected the connection.",
        });
      }
      return;
    }

    if (ev === "presence_state") {
      for (const [key, val] of Object.entries(p ?? {})) {
        if (key === this.selfId) continue;
        const meta = (val as { metas?: { name?: string; role?: string }[] })?.metas?.[0];
        if (!meta) continue;
        if (!this.seats.has(key)) this.seats.set(key, { name: meta.name ?? "Player", ready: false });
        if (meta.role === "host") {
          this.hostId = key;
          this.sawHost = true;
        }
      }
      this.syncSeats();
      if (this.queued) this.scheduleHost();
      return;
    }

    if (ev === "presence_diff") {
      const joins = (p?.joins ?? {}) as Record<string, { metas?: { name?: string; role?: string }[] }>;
      const leaves = (p?.leaves ?? {}) as Record<string, { metas?: { name?: string }[] }>;
      for (const [key, val] of Object.entries(joins)) {
        if (key === this.selfId) continue;
        const meta = val?.metas?.[0];
        if (!this.seats.has(key)) this.seats.set(key, { name: meta?.name ?? "Player", ready: false });
        if (meta?.role === "host") {
          this.hostId = key;
          this.sawHost = true;
        }
      }
      for (const [key, val] of Object.entries(leaves)) {
        if (key === this.selfId) continue;
        const gone = this.seats.get(key);
        this.seats.delete(key);
        this.emit({ t: "peer-left", id: key, name: gone?.name ?? val?.metas?.[0]?.name ?? "Opponent" });
      }
      this.syncSeats();
      if (this.queued) this.scheduleHost();
      return;
    }

    if (ev === "broadcast") {
      const kind = p?.event as string | undefined;
      const data = p?.payload as any;

      if (kind === "sig") {
        if (data?.to && data.to !== this.selfId) return;
        this.emit({ t: "signal", from: data?.from ?? "", data: data?.data });
        return;
      }

      if (kind === "hello" && this.isHost) {
        const from = data?.id as string | undefined;
        if (!from || from === this.selfId) return;
        this.seats.set(from, { name: data?.name ?? "Guest", ready: false });
        this.syncSeats();
        return;
      }

      if (kind === "room" && !this.isHost && data?.room) {
        const room = data.room as RoomState;
        this.hostId = room.host?.id ?? this.hostId;
        if (this.hostId) this.sawHost = true;
        if (data.room.meta !== undefined) this.meta = data.room.meta as Record<string, unknown> | null;
        this.phase = room.phase ?? "lobby";
        this.settings = room.settings ?? this.settings;
        if (room.host) this.seats.set(room.host.id, { name: room.host.name, ready: !!room.host.ready });
        if (room.guest) this.seats.set(room.guest.id, { name: room.guest.name, ready: !!room.guest.ready });
        this.emitRoom();
        return;
      }

      if (kind === "ready" && this.isHost) {
        const from = data?.id as string | undefined;
        if (from) {
          const seat = this.seats.get(from);
          if (seat) seat.ready = !!data?.ready;
          this.syncSeats();
        }
        return;
      }

      if (kind === "who" && this.queued && data?.from && data.from !== this.selfId) {
        this.broadcast("here", { from: this.selfId, to: data.from });
        return;
      }

      if (kind === "here" && this.queued && data?.to === this.selfId && data?.from) {
        if (!this.replies.includes(data.from)) this.replies.push(data.from);
        return;
      }

      if (kind === "claim" && this.queued && data?.from !== this.selfId) {
        // Someone else is taking this pairing; stand down and wait for room.
        if (this.hostTimer !== null) window.clearTimeout(this.hostTimer);
        this.hostTimer = null;
        return;
      }

      if (kind === "pair" && this.queued && data?.to === this.selfId && data?.code) {
        if (this.hostTimer !== null) window.clearTimeout(this.hostTimer);
        this.hostTimer = null;
        this.queued = false;
        this.paired = true;
        this.isHost = false;
        this.seats.clear();
        const code = String(data.code);
        void this.openChannel(`realtime:${ROOM_PREFIX}${code}`, code).then(() => {
          this.seats.set(this.selfId, { name: this.name, ready: false });
          this.trackPresence();
          this.emit({ t: "joined", code, selfId: this.selfId, room: this.roomState() });
          this.broadcast("hello", { id: this.selfId, name: this.name });
        });
        return;
      }

      if (kind === "bye" && !this.isHost) {
        this.emit({ t: "peer-left", id: data?.id ?? "", name: data?.name ?? "Opponent" });
      }
    }
  }

  /**
   * Hosting is staggered by id instead of claimed by the lowest alone: the
   * lowest id goes first, the next waits a beat and takes over if nothing
   * happened. A queued entry left behind by a closed tab can't stall everyone.
   */
  private scheduleHost() {
    if (!this.queued || this.paired || this.hostTimer !== null) return;
    const others = [...this.seats.keys()].filter((id) => id !== this.selfId);
    if (!others.length) return;
    const rank = [...others, this.selfId].sort().indexOf(this.selfId);
    const delay = 250 + Math.max(0, rank) * 700;
    this.hostTimer = window.setTimeout(() => {
      this.hostTimer = null;
      if (this.queued && !this.paired) this.hostRoom();
    }, delay);
  }

  private hostRoom() {
    if (!this.queued || this.paired) return;
    const others = [...this.seats.keys()].filter((id) => id !== this.selfId);
    if (!others.length) return;
    // Presence can outlive a closed tab, so ask who is actually listening and
    // only ever pair with someone who answered.
    this.replies = [];
    this.broadcast("who", { from: this.selfId });
    window.setTimeout(() => {
      if (!this.queued || this.paired) return;
      const other = [...this.replies].sort()[0];
      if (!other) {
        this.hostTimer = window.setTimeout(() => {
          this.hostTimer = null;
          if (this.queued && !this.paired) this.hostRoom();
        }, 1200);
        return;
      }
      this.completePair(other);
    }, 450);
  }

  private completePair(other: string) {
    if (!this.queued || this.paired) return;
    this.paired = true;
    this.broadcast("claim", { from: this.selfId });
    const code = makeRoomCode();
    this.broadcast("pair", { to: other, code });
    this.isHost = true;
    this.hostId = this.selfId;
    this.seats.clear();
    void this.openChannel(`realtime:${ROOM_PREFIX}${code}`, code)
      .then(() => {
        this.seats.set(this.selfId, { name: this.name, ready: false });
        this.trackPresence();
        this.emit({ t: "created", code, selfId: this.selfId, room: this.roomState() });
      })
      .catch((err: Error) => this.emit({ t: "error", code: "queue", message: err.message }));
  }

  /** Host: publish the room after any membership or settings change. */
  private syncSeats() {
    if (!this.roomCode) return;
    this.emitRoom();
    if (this.isHost) this.broadcast("room", { room: { ...this.roomState(), meta: this.meta } });
  }

  private roomState(): RoomState {
    const hostId = this.isHost ? this.selfId : this.hostId;
    const guestId = this.isHost
      ? [...this.seats.keys()].find((id) => id !== this.selfId) ?? null
      : this.selfId;
    const seat = (id: string | null, role: "host" | "guest") => {
      if (!id) return null;
      const known = this.seats.get(id);
      const name = id === this.selfId ? this.name : known?.name ?? (role === "host" ? "Host" : "Guest");
      return { id, name, role, ready: known?.ready ?? false, connected: true };
    };
    return {
      code: this.roomCode,
      host: seat(hostId || null, "host"),
      guest: seat(guestId, "guest"),
      settings: this.settings,
      phase: this.phase,
    };
  }

  private emitRoom() {
    if (!this.roomCode) return;
    const room = this.roomState();
    this.emit({ t: "room", room: { ...room, meta: this.meta } as RoomState });
  }

  send(obj: unknown) {
    const m = obj as {
      t?: string;
      code?: string;
      ready?: boolean;
      data?: unknown;
      room?: { phase?: "lobby" | "select" | "match"; settings?: Record<string, unknown>; meta?: Record<string, unknown> };
    };
    switch (m.t) {
      case "queue": {
        const mode = (m as { mode?: string }).mode ?? "casual";
        void this.joinQueue(mode).catch((err: Error) =>
          this.emit({ t: "error", code: "queue", message: err.message })
        );
        break;
      }
      case "create": {
        this.isHost = true;
        this.queued = false;
        this.hostId = this.selfId;
        const code = makeRoomCode();
        void this.joinChannel(code)
          .then(() => {
            this.seats.set(this.selfId, { name: this.name, ready: false });
            this.trackPresence();
            this.emit({ t: "created", code, selfId: this.selfId, room: this.roomState() });
          })
          .catch((err: Error) => this.emit({ t: "error", code: "create", message: err.message }));
        break;
      }
      case "join": {
        this.isHost = false;
        const code = (m.code ?? "").toUpperCase().trim();
        void this.joinChannel(code)
          .then(() => {
            this.seats.set(this.selfId, { name: this.name, ready: false });
            this.trackPresence();
            this.emit({ t: "joined", code, selfId: this.selfId, room: this.roomState() });
            this.broadcast("hello", { id: this.selfId, name: this.name });
            this.joinTimer = window.setTimeout(() => {
              if (!this.sawHost) {
                this.emit({ t: "error", code: "no-room", message: `No room is open with code ${code}.` });
              }
            }, JOIN_GRACE_MS);
          })
          .catch((err: Error) => this.emit({ t: "error", code: "join", message: err.message }));
        break;
      }
      case "signal": {
        this.broadcast("sig", { from: this.selfId, to: (m.data as { to?: string } | undefined)?.to, data: m.data });
        break;
      }
      case "room-set": {
        if (!this.isHost) break;
        this.meta = m.room?.meta ?? this.meta;
        this.phase = m.room?.phase ?? this.phase;
        this.settings = m.room?.settings ?? this.settings;
        this.syncSeats();
        break;
      }
      case "ready": {
        const me = this.seats.get(this.selfId);
        if (me) me.ready = !!m.ready;
        if (this.isHost) {
          this.syncSeats();
        } else {
          this.broadcast("ready", { id: this.selfId, ready: !!m.ready });
          this.emitRoom();
        }
        break;
      }
      case "leave": {
        if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
        this.broadcast("bye", { id: this.selfId, name: this.name });
        break;
      }
      default:
        break;
    }
  }

  close() {
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.joinTimer !== null) window.clearTimeout(this.joinTimer);
    this.roomCode = "";
    this.queued = false;
    this.paired = false;
    if (this.hostTimer !== null) window.clearTimeout(this.hostTimer);
    this.hostTimer = null;
    this.seats.clear();
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }
}
