// Online rooms: signaling membership, WebRTC negotiation, room metadata sync
// and the hand-off into a rollback match.
//
// Roles: the host is authoritative for room metadata (settings, phase, seed).
// The guest sends its team pick to the host, which rebroadcasts the whole room.

import { RtcPeer, type PeerState } from "../net/peer";
import { RollbackSession } from "../net/rollback";
import { SignalClient, resolveSignalUrl, type RoomState, type SignalMessage, type SignalLike } from "../net/signal";
import { RealtimeSignal, loadRealtimeConfig } from "../net/signal-rt";
import { createState } from "../game/engine";
import { input } from "../game/input";
import type { MatchConfig } from "../game/types";
import type { TeamPick } from "./charselect";

export interface RoomMeta {
  picks: { host?: TeamPick; guest?: TeamPick };
  locked: { host: boolean; guest: boolean };
  seed: number;
  stage: number;
  timer: number;
  startedAt: number;
}

export interface RoomData extends RoomState {
  meta: RoomMeta;
}

const emptyMeta = (): RoomMeta => ({
  picks: {},
  locked: { host: false, guest: false },
  seed: 0,
  stage: 0,
  timer: 99,
  startedAt: 0,
});

export interface OnlineHooks {
  onRoom: (room: RoomData) => void;
  onError: (message: string) => void;
  onPeerState: (s: PeerState, detail?: string) => void;
  onPhase: (phase: "lobby" | "select" | "match") => void;
}

export class OnlineClient {
  signal: SignalLike | null = null;
  peer: RtcPeer | null = null;
  room: RoomData | null = null;
  selfId = "";
  isHost = false;
  name = "Player";
  hooks: OnlineHooks;
  latency = 0;
  private signalUrl = "";

  constructor(hooks: OnlineHooks) {
    this.hooks = hooks;
  }

  get code(): string {
    return this.room?.code ?? "";
  }

  get isInRoom(): boolean {
    return this.room !== null;
  }

  private role(): "host" | "guest" {
    return this.isHost ? "host" : "guest";
  }

  async connect(name: string): Promise<void> {
    this.name = name || "Player";
    // Hosted builds signal through Supabase Realtime so online play needs no
    // server of its own; the local Node server stays as the offline fallback.
    const rt = await loadRealtimeConfig();
    let sig: SignalLike;
    if (rt) {
      sig = new RealtimeSignal(rt, this.name);
    } else {
      this.signalUrl = await resolveSignalUrl();
      sig = new SignalClient({ url: this.signalUrl, name: this.name });
    }
    this.signal = sig;
    sig.onMessage((m) => this.onSignal(m));
    await sig.connect();
    this.selfId = sig.selfId;
    const poll = window.setInterval(() => {
      if (this.signal) this.latency = this.signal.latencyMs;
    }, 1500);
    sig.onMessage(() => {
      /* keep the interval alive until close */
    });
    window.setTimeout(() => window.clearInterval(poll), 1000 * 60 * 60 * 4);
  }

  /** Join the matchmaking queue; pairing happens on the queue channel. */
  async quickMatch(mode: "casual" | "ranked" = "casual"): Promise<void> {
    this.name = this.name || "Player";
    const rt = await loadRealtimeConfig();
    if (!rt) throw new Error("Quick Match needs the online service, which is not configured for this build.");
    const sig = new RealtimeSignal(rt, this.name);
    this.signal = sig;
    sig.onMessage((m) => this.onSignal(m));
    await sig.connect();
    this.selfId = sig.selfId;
    sig.send({ t: "queue", mode });
  }

  cancelQueue() {
    this.leave();
  }

  async createRoom(): Promise<void> {
    await this.connect(this.name);
    this.isHost = true;
    this.signal!.send({ t: "create", name: this.name, settings: { stage: 0, timer: 99 } });
  }

  async joinRoom(code: string): Promise<void> {
    await this.connect(this.name);
    this.isHost = false;
    this.signal!.send({ t: "join", code: code.toUpperCase().trim(), name: this.name });
  }

  private onSignal(m: SignalMessage) {
    switch (m.t) {
      case "created": {
        this.selfId = m.selfId;
        this.isHost = true;
        this.setRoom(m.room as RoomData, true);
        break;
      }
      case "joined": {
        this.selfId = m.selfId;
        this.isHost = false;
        this.setRoom(m.room as RoomData, true);
        break;
      }
      case "room": {
        this.setRoom(m.room as RoomData, false);
        break;
      }
      case "peer-left": {
        this.hooks.onError(`${m.name} left the room.`);
        this.closePeer();
        break;
      }
      case "signal": {
        this.onPeerSignal(m.data);
        break;
      }
      case "error": {
        this.hooks.onError(m.message);
        break;
      }
      default:
        break;
    }
  }

  private setRoom(raw: RoomData, initial: boolean) {
    const prevPhase = this.room?.phase;
    const room: RoomData = {
      ...raw,
      meta: { ...emptyMeta(), ...(raw.meta ?? {}) },
    };
    this.room = room;

    // Start WebRTC once both seats are occupied.
    if (room.host && room.guest && !this.peer) {
      this.startPeer();
    }
    this.hooks.onRoom(room);
    if (!initial && room.phase !== prevPhase) this.hooks.onPhase(room.phase);
    if (initial) this.hooks.onPhase(room.phase);

    // Host drives the phase machine: once both teams are locked, launch.
    if (this.isHost && room.phase === "select") this.maybeLaunch();
  }

  private startPeer() {
    const room = this.room;
    if (!room || !room.host || !room.guest) return;
    const initiator = this.isHost;
    const peer = new RtcPeer(
      initiator,
      this.isHost ? room.guest.id : room.host.id,
      (data) => this.signal?.send({ t: "signal", data }),
      {
        onState: (s, detail) => this.hooks.onPeerState(s, detail),
        onMessage: () => {
          /* replaced by the match screen */
        },
      }
    );
    this.peer = peer;
    peer.start().catch((err: Error) => this.hooks.onError(err.message));
  }

  private onPeerSignal(data: unknown) {
    const d = data as { kind?: string; pick?: TeamPick };
    if ((d.kind === "pick" || d.kind === "lock") && this.isHost) {
      // guest pick arrives over the relay; host is authoritative
      const meta = this.room?.meta ?? emptyMeta();
      if (d.pick) meta.picks.guest = d.pick;
      if (d.kind === "lock") meta.locked.guest = true;
      this.pushRoom({ meta }, false);
      return;
    }
    if (this.peer) {
      this.peer.handleSignal(data).catch((err: Error) => this.hooks.onError(err.message));
    }
  }

  /** Host-only: merge and broadcast room changes. */
  pushRoom(patch: { meta?: Partial<RoomMeta>; phase?: RoomData["phase"]; settings?: Record<string, unknown>; hostReady?: boolean; guestReady?: boolean }, local = true) {
    if (!this.room) return;
    if (!this.isHost) return;
    const meta: RoomMeta = { ...this.room.meta, ...(patch.meta ?? {}) };
    this.room = { ...this.room, meta, phase: patch.phase ?? this.room.phase };
    this.signal?.send({
      t: "room-set",
      room: {
        phase: patch.phase ?? this.room.phase,
        settings: patch.settings ?? this.room.settings,
        meta,
        hostReady: patch.hostReady ?? this.room.host?.ready ?? false,
        guestReady: patch.guestReady ?? this.room.guest?.ready ?? false,
      },
    });
  }

  setReady(ready: boolean) {
    this.signal?.send({ t: "ready", ready });
  }

  /** Send a live pick preview to the host (no effect for the host itself). */
  previewPick(pick: TeamPick) {
    if (this.isHost) return;
    this.signal?.send({ t: "signal", data: { kind: "pick", pick } });
  }

  /** Local player committed their team. */
  submitPick(pick: TeamPick) {
    const role = this.role();
    if (this.isHost) {
      const meta = this.room?.meta ?? emptyMeta();
      meta.picks.host = pick;
      meta.locked.host = true;
      this.pushRoom({ meta });
    } else {
      this.signal?.send({ t: "signal", data: { kind: "lock", pick } });
    }
    void role;
  }

  /** Host: both players ready -> move the room into team select. */
  beginSelect(): boolean {
    if (!this.isHost || !this.room) return false;
    if (!this.room.guest) return false;
    if (!this.room.host?.ready || !this.room.guest.ready) return false;
    this.pushRoom({ phase: "select" });
    return true;
  }

  /** Host: both teams locked -> launch the rollback match. */
  maybeLaunch(): boolean {
    if (!this.isHost || !this.room || this.room.phase !== "select") return false;
    const { picks, locked } = this.room.meta;
    if (!locked.host || !locked.guest || !picks.host || !picks.guest) return false;
    this.pushRoom({
      meta: { seed: ((Math.random() * 0x7fffffff) | 0) || 987654, startedAt: Date.now() },
      phase: "match",
    });
    return true;
  }

  resetToLobby() {
    if (!this.isHost) return;
    const meta: RoomMeta = { ...emptyMeta(), picks: {}, locked: { host: false, guest: false } };
    this.pushRoom({ meta, phase: "lobby", hostReady: false, guestReady: false });
    this.signal?.send({ t: "ready", ready: false });
  }

  buildMatch(localTeam: 0 | 1): { cfg: MatchConfig; session: RollbackSession } | null {
    const room = this.room;
    if (!room || !room.meta.picks.host || !room.meta.picks.guest || !this.peer) return null;
    const hostPick = room.meta.picks.host;
    const guestPick = room.meta.picks.guest;
    const cfg: MatchConfig = {
      teams: [hostPick.chars, guestPick.chars],
      assists: [hostPick.assists, guestPick.assists],
      colors: [hostPick.colors, guestPick.colors],
      stage: room.meta.stage ?? 0,
      timer: (room.meta.timer ?? 99) * 60,
      training: false,
      dummy: 0,
      difficulty: 2,
      seed: room.meta.seed || 12345,
      cpu: false,
    };
    const peer = this.peer;
    const state = createState(cfg);
    const session = new RollbackSession(cfg, localTeam, state, (payload) => peer.send(payload));
    return { cfg, session };
  }

  inviteLink(): string {
    const url = new URL(window.location.href);
    url.searchParams.set("room", this.code);
    return url.toString();
  }

  closePeer() {
    this.peer?.close();
    this.peer = null;
  }

  leave() {
    this.signal?.send({ t: "leave" });
    this.closePeer();
    this.signal?.close();
    this.signal = null;
    this.room = null;
    input.enabled = false;
  }
}
