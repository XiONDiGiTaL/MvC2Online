// Global lobby: who is on the site right now, plus the shared chat.
//
// This is the same Phoenix-protocol socket the room signaling uses, joined to
// one long-lived topic so presence survives navigation. Nothing here touches
// gameplay: the lobby carries membership and text only, and chat is broadcast
// (ephemeral by design — no moderation surface, nothing stored).

import { loadRealtimeConfig, makeId, type RealtimeConfig } from "./signal-rt";

const HEARTBEAT_MS = 25_000;
// A presence entry that has not re-announced itself within this window belongs
// to a tab that is gone (closed uncleanly, crashed, or frozen). The window is
// generous because background tabs get their timers throttled to about once a
// minute. Re-announcing is cheap: one small broadcast every PRESENCE_BEAT_MS.
const PRESENCE_BEAT_MS = 20_000;
const PRESENCE_TTL_MS = 90_000;
const CHAT_MAX = 240;
const CHAT_COOLDOWN_MS = 700;
const TOPIC = "realtime:mvc2:lobby";

export interface LobbyIdentity {
  name: string;
  /** portrait key (`@portrait:12`) or an uploaded data URL */
  avatar: string;
  /** open room code, so others can join straight from the roster */
  room: string | null;
  /** in team select or a match: inviteable, but not interruptible */
  busy: boolean;
}

export type InviteReply = "accepted" | "declined" | "busy";

export interface LobbyUser {
  id: string;
  name: string;
  avatar: string;
  room: string | null;
  /** locked into a team-select or a match: not available to challenge */
  busy: boolean;
  self: boolean;
}

export type LobbyEvent =
  | { t: "status"; status: "connecting" | "online" | "offline"; detail?: string }
  | { t: "users"; users: LobbyUser[] }
  | { t: "chat"; id: string; name: string; avatar: string; text: string; ts: number }
  | { t: "system"; text: string }
  | { t: "invite"; from: string; name: string; code: string }
  | { t: "invite-reply"; from: string; name: string; code: string; state: InviteReply };

type Handler = (e: LobbyEvent) => void;

// The live lobby is created at boot; the room layer is built later and deeper
// in the tree, so it announces its room through this binding instead of
// threading a reference through every screen.
let activeLobby: LobbyClient | null = null;

export function bindLobby(client: LobbyClient | null) {
  activeLobby = client;
}

/** Publish (or clear) the room code others can join from the lobby roster. */
export function announceRoom(code: string | null) {
  activeLobby?.setRoom(code && code.trim() ? code.trim().toUpperCase() : null);
}

/** Challenge someone: point them at our room without them typing a code. */
export function sendLobbyInvite(to: string, code: string): boolean {
  return activeLobby?.sendInvite(to, code) ?? false;
}

/**
 * Mark ourselves unavailable (team select / mid-match) so the roster shows it
 * and nobody wastes a challenge on us.
 */
/** Answer a challenge so the other player stops waiting on it. */
export function sendLobbyInviteReply(to: string, code: string, state: InviteReply): boolean {
  return activeLobby?.sendInviteReply(to, code, state) ?? false;
}

export function announceBusy(busy: boolean) {
  activeLobby?.setBusy(busy);
}

interface PresenceMeta {
  name?: string;
  avatar?: string;
  room?: string | null;
  busy?: boolean;
  /** counter that changes on every announcement, forcing a presence diff */
  beat?: number;
}

export class LobbyClient {
  selfId = makeId();
  identity: LobbyIdentity = { name: "Player", avatar: "", room: null, busy: false };
  status: "connecting" | "online" | "offline" = "offline";

  private cfg: RealtimeConfig | null = null;
  private ws: WebSocket | null = null;
  private ref = 0;
  private joined = false;
  private handlers = new Set<Handler>();
  private users = new Map<string, LobbyUser>();
  private heartbeat: number | null = null;
  private retry = 0;
  private retryTimer: number | null = null;
  private lastChatAt = 0;
  private closing = false;
  /** when we last heard a presence announcement per key (local clock) */
  private lastSeen = new Map<string, number>();
  /** bumped on every announce so peers always get a fresh meta */
  private beat = 0;
  private sweep: number | null = null;

  on(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit(e: LobbyEvent) {
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error("[lobby] handler threw", err);
      }
    }
  }

  private setStatus(status: "connecting" | "online" | "offline", detail?: string) {
    this.status = status;
    this.emit({ t: "status", status, detail });
  }

  private emitUsers() {
    const users = [...this.users.values()].sort((a, b) => {
      if (a.self !== b.self) return a.self ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    this.emit({ t: "users", users });
  }

  async connect(): Promise<void> {
    this.cfg = await loadRealtimeConfig();
    if (!this.cfg) {
      this.setStatus("offline", "No lobby configured");
      return;
    }
    this.open();
  }

  private open() {
    if (!this.cfg || this.closing) return;
    const { url, key } = this.cfg;
    const endpoint =
      `${url.replace(/^http/, "ws")}/realtime/v1/websocket` +
      `?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint);
    } catch {
      this.setStatus("offline", "Could not open the lobby socket");
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.join();
      if (this.heartbeat === null) {
        this.heartbeat = window.setInterval(() => {
          this.raw({ topic: "phoenix", event: "heartbeat", payload: {}, ref: this.nextRef() });
        }, HEARTBEAT_MS);
      }
      if (this.sweep === null) {
        this.sweep = window.setInterval(() => this.sweepPresence(), PRESENCE_BEAT_MS);
      }
    };

    ws.onclose = () => {
      this.joined = false;
      if (this.heartbeat !== null) {
        window.clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
      if (this.sweep !== null) {
        window.clearInterval(this.sweep);
        this.sweep = null;
      }
      this.users.clear();
      this.lastSeen.clear();
      this.emitUsers();
      this.setStatus("offline");
      this.scheduleRetry();
    };

    ws.onerror = () => {
      if (!this.joined) this.setStatus("offline", "Lobby unreachable");
    };

    ws.onmessage = (ev) => {
      let msg: { event?: string; ref?: string; payload?: any };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.receive(msg);
    };
  }

  private scheduleRetry() {
    // A site-wide lobby should come back on its own after a flaky moment.
    if (this.closing || this.retryTimer !== null) return;
    const delay = Math.min(30_000, 1500 * 2 ** this.retry);
    this.retry += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private nextRef() {
    this.ref += 1;
    return String(this.ref);
  }

  private raw(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private join() {
    this.joined = true;
    this.raw({
      topic: TOPIC,
      event: "phx_join",
      payload: { config: { broadcast: { self: false }, presence: { key: this.selfId } } },
      ref: this.nextRef(),
    });
  }

  private track() {
    this.raw({
      topic: TOPIC,
      event: "presence",
      payload: {
        type: "presence",
        event: "track",
        payload: {
          name: this.identity.name,
          avatar: this.identity.avatar,
          room: this.identity.room,
          busy: this.identity.busy === true,
          beat: ++this.beat,
        },
      },
      ref: this.nextRef(),
    });
    this.lastSeen.set(this.selfId, Date.now());
  }

  /**
   * The realtime server only drops a presence entry when it notices the socket
   * dying, which a browser closing a tab does not always make obvious. So we
   * keep our own clock: live players re-announce every PRESENCE_BEAT_MS, and
   * anyone who has gone quiet for PRESENCE_TTL_MS is taken off the roster.
   */
  private sweepPresence() {
    if (this.status !== "online" || !this.joined) return;
    // A re-track does not reliably reach other clients as a presence diff, so
    // liveness rides the broadcast channel instead: everyone hears the beat.
    this.raw({
      topic: TOPIC,
      event: "broadcast",
      payload: {
        type: "broadcast",
        event: "beat",
        payload: { from: this.selfId },
      },
      ref: this.nextRef(),
    });

    const now = Date.now();
    let dropped = false;
    for (const [key, seen] of this.lastSeen) {
      if (key === this.selfId || now - seen < PRESENCE_TTL_MS) continue;
      const gone = this.users.get(key);
      this.lastSeen.delete(key);
      this.users.delete(key);
      dropped = true;
      if (gone && !gone.self) this.emit({ t: "system", text: `${gone.name} left` });
    }
    if (dropped) this.emitUsers();
  }

  /** Profile or room change: re-track so everyone sees it immediately. */
  setIdentity(patch: Partial<LobbyIdentity>) {
    this.identity = { ...this.identity, ...patch };
    this.users.set(this.selfId, {
      id: this.selfId,
      name: this.identity.name,
      avatar: this.identity.avatar,
      room: this.identity.room,
      busy: this.identity.busy === true,
      self: true,
    });
    this.emitUsers();
    if (this.joined) this.track();
  }

  /**
   * Presence is keyed by our session id. Signing in swaps that key for the
   * account id so friends resolve on any device, which means the socket has to
   * rejoin with the new key.
   */
  identifyAs(id: string) {
    if (!id || id === this.selfId) return;
    this.selfId = id;
    this.users.delete(id);
    this.users.set(id, {
      id,
      name: this.identity.name,
      avatar: this.identity.avatar,
      room: this.identity.room,
      busy: this.identity.busy === true,
      self: true,
    });
    this.emitUsers();
    this.joined = false;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    // onclose schedules the reconnect, which rejoins with the new key.
  }

  setRoom(code: string | null) {
    if (this.identity.room === code) return;
    this.setIdentity({ room: code });
  }

  sendInviteReply(to: string, code: string, state: InviteReply): boolean {
    if (!to || this.status !== "online") return false;
    this.raw({
      topic: TOPIC,
      event: "broadcast",
      payload: {
        type: "broadcast",
        event: "invite-reply",
        payload: {
          to,
          from: this.selfId,
          name: this.identity.name,
          code: code.trim().toUpperCase(),
          state,
        },
      },
      ref: this.nextRef(),
    });
    return true;
  }

  setBusy(busy: boolean) {
    if (this.identity.busy === busy) return;
    this.setIdentity({ busy });
  }

  /**
   * Target the invite at one presence key. Broadcast (not presence state), so
   * nothing about it lingers after the recipient leaves.
   */
  sendInvite(to: string, code: string): boolean {
    if (!to || !code || this.status !== "online") return false;
    const room = code.trim().toUpperCase();
    this.raw({
      topic: TOPIC,
      event: "broadcast",
      payload: {
        type: "broadcast",
        event: "invite",
        payload: { to, code: room, from: this.selfId, name: this.identity.name },
      },
      ref: this.nextRef(),
    });
    return true;
  }

  /** Returns false when throttled or empty, so the UI can keep the draft. */
  sendChat(text: string): boolean {
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, CHAT_MAX);
    if (!clean) return false;
    const now = Date.now();
    if (now - this.lastChatAt < CHAT_COOLDOWN_MS) return false;
    this.lastChatAt = now;
    this.raw({
      topic: TOPIC,
      event: "broadcast",
      payload: {
        type: "broadcast",
        event: "chat",
        payload: { from: this.selfId, name: this.identity.name, avatar: this.identity.avatar, text: clean },
      },
      ref: this.nextRef(),
    });
    // Broadcast is self:false, so echo locally instead of waiting for a round trip.
    this.emit({
      t: "chat",
      id: this.selfId,
      name: this.identity.name,
      avatar: this.identity.avatar,
      text: clean,
      ts: now,
    });
    return true;
  }

  private receive(msg: { event?: string; ref?: string; payload?: any }) {
    const ev = msg.event;
    const p = msg.payload;

    if (ev === "phx_reply") {
      if (p?.status === "ok" && this.joined && this.status !== "online") {
        this.setStatus("online");
        this.track();
      } else if (p?.status && p.status !== "ok") {
        this.setStatus("offline", p?.response?.reason ? String(p.response.reason) : "Lobby rejected the join");
      }
      return;
    }

    if (ev === "presence_state") {
      this.users.clear();
      this.lastSeen.clear();
      for (const [key, val] of Object.entries(p ?? {})) {
        this.absorb(key, (val as { metas?: PresenceMeta[] })?.metas?.[0]);
      }
      this.seedSelf();
      this.emitUsers();
      return;
    }

    if (ev === "presence_diff") {
      const joins = (p?.joins ?? {}) as Record<string, { metas?: PresenceMeta[] }>;
      const leaves = (p?.leaves ?? {}) as Record<string, { metas?: PresenceMeta[] }>;
      for (const [key, val] of Object.entries(joins)) this.absorb(key, val?.metas?.[0]);
      for (const key of Object.keys(leaves)) {
        const gone = this.users.get(key);
        if (gone && !gone.self) this.emit({ t: "system", text: `${gone.name} left` });
        this.users.delete(key);
        this.lastSeen.delete(key);
      }
      this.emitUsers();
      return;
    }

    if (ev === "broadcast" && p?.event === "invite") {
      const d = p.payload as { to?: string; from?: string; name?: string; code?: string } | undefined;
      if (!d?.to || d.to !== this.selfId || !d.code) return;
      this.emit({
        t: "invite",
        from: String(d.from ?? ""),
        name: String(d.name ?? "A player").slice(0, 24),
        code: String(d.code).toUpperCase().slice(0, 8),
      });
      return;
    }

    if (ev === "broadcast" && p?.event === "beat") {
      const d = p.payload as { from?: string } | undefined;
      if (d?.from && d.from !== this.selfId) this.lastSeen.set(d.from, Date.now());
      return;
    }

    if (ev === "broadcast" && p?.event === "invite-reply") {
      const d = p.payload as { to?: string; from?: string; name?: string; code?: string; state?: string } | undefined;
      if (!d?.to || d.to !== this.selfId) return;
      const state = d.state === "accepted" || d.state === "busy" ? d.state : "declined";
      this.emit({
        t: "invite-reply",
        from: String(d.from ?? ""),
        name: String(d.name ?? "A player").slice(0, 24),
        code: String(d.code ?? "").toUpperCase().slice(0, 8),
        state,
      });
      return;
    }

    if (ev === "broadcast" && p?.event === "chat") {
      const d = p.payload as { from?: string; name?: string; avatar?: string; text?: string } | undefined;
      if (!d?.from || d.from === this.selfId) return; // own messages were echoed locally
      const text = String(d.text ?? "").slice(0, CHAT_MAX);
      if (!text) return;
      this.emit({
        t: "chat",
        id: d.from,
        name: String(d.name ?? "Player").slice(0, 24),
        avatar: String(d.avatar ?? ""),
        text,
        ts: Date.now(),
      });
    }
  }

  private absorb(key: string, meta: PresenceMeta | undefined) {
    if (!meta || key === this.selfId) return;
    // Any announcement — join, re-beat or room change — proves the tab is alive.
    this.lastSeen.set(key, Date.now());
    const fresh = !this.users.has(key);
    this.users.set(key, {
      id: key,
      name: String(meta.name ?? "Player").slice(0, 24),
      avatar: String(meta.avatar ?? ""),
      room: meta.room ? String(meta.room) : null,
      busy: meta.busy === true,
      self: false,
    });
    if (fresh) this.emit({ t: "system", text: `${meta.name ?? "Player"} joined` });
  }

  private seedSelf() {
    this.users.set(this.selfId, {
      id: this.selfId,
      name: this.identity.name,
      avatar: this.identity.avatar,
      room: this.identity.room,
      busy: this.identity.busy === true,
      self: true,
    });
    this.lastSeen.set(this.selfId, Date.now());
  }

  close() {
    this.closing = true;
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.sweep !== null) window.clearInterval(this.sweep);
    this.sweep = null;
    // Leaving the topic clears our presence entry immediately, so a clean exit
    // never needs the staleness sweep to notice it.
    if (this.joined) {
      this.raw({ topic: TOPIC, event: "phx_leave", payload: {}, ref: this.nextRef() });
      this.joined = false;
    }
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }
}
