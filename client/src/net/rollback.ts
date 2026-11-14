// Rollback session (GGPO-style).
//
// Both clients run the same deterministic 60 Hz simulation. Each frame:
//   1. sample the local input, store it, and send it to the peer
//   2. predict the remote input (last confirmed value)
//   3. step the simulation
//   4. store a snapshot
// When a real remote input arrives for an already-simulated frame and differs
// from the prediction, the state is rewound to that frame and resimulated
// forward. This is real rollback, not input lockstep with delay.

import { cloneState, stateHash, stepGame } from "../game/engine";
import type { MatchConfig, SimState } from "../game/types";

const SNAP_DEPTH = 180;

export interface RollbackStats {
  frame: number;
  rollbacks: number;
  lastRollbackDepth: number;
  predicted: boolean;
  checksum: number;
  desync: boolean;
  remoteLagFrames: number;
}

export class RollbackSession {
  state: SimState;
  cfg: MatchConfig;
  localTeam: number;
  frame = 0;

  private snaps = new Map<number, SimState>();
  private localIn = new Map<number, number>();
  private remoteIn = new Map<number, number>();
  private usedRemote = new Map<number, number>();
  private hashes = new Map<number, number>();
  /** Recent local inputs, resent with every packet for loss recovery. */
  private recent: [number, number][] = [];
  private lastRemote = 0;
  private lastRemoteFrame = 0;
  private checksumSent = 0;
  private remoteChecksums = new Map<number, number>();

  rollbacks = 0;
  lastDepth = 0;
  desync = false;
  private send: (payload: string) => void;

  constructor(cfg: MatchConfig, localTeam: number, initialState: SimState, send: (payload: string) => void) {
    this.cfg = cfg;
    this.localTeam = localTeam;
    this.state = initialState;
    this.send = send;
    this.snaps.set(0, cloneState(initialState));
    this.remoteIn.set(0, 0);
  }

  private localMaskFor(team: number, localMask: number, remoteMask: number): [number, number] {
    return this.localTeam === 0 ? [localMask, remoteMask] : [remoteMask, localMask];
  }

  private stepWith(localMask: number, f: number) {
    const remote = this.remoteIn.get(f) ?? this.lastRemote;
    this.usedRemote.set(f, remote);
    const [i0, i1] = this.localMaskFor(this.localTeam, localMask, remote);
    stepGame(this.state, this.cfg, i0, i1);
    this.frame = f;
    this.snaps.set(f, cloneState(this.state));
    this.hashes.set(f, stateHash(this.state));
    if (this.snaps.size > SNAP_DEPTH) {
      const oldest = f - SNAP_DEPTH;
      for (const key of this.snaps.keys()) {
        if (key < oldest) this.snaps.delete(key);
      }
      for (const key of this.hashes.keys()) {
        if (key < oldest) this.hashes.delete(key);
      }
    }
  }

  /** Advance exactly one frame with the given local input. */
  advance(localMask: number) {
    const f = this.frame + 1;
    this.localIn.set(f, localMask);
    this.stepWith(localMask, f);

    // Every packet carries the last few inputs, so one dropped packet does not
    // stall or desync the peer (the data channel is deliberately unreliable).
    this.recent.push([f, localMask]);
    if (this.recent.length > 8) this.recent.shift();
    this.send(JSON.stringify({ t: "in", f, m: localMask, b: this.recent }));

    // Send the checksum of a frame that is already settled on this client, not
    // the live frame: a live frame can still be changed by a rollback, which
    // would make a perfectly in-sync peer look diverged.
    if (f - this.checksumSent >= 30) {
      this.checksumSent = f;
      const target = f - 20;
      const h = this.hashes.get(target);
      if (h !== undefined) this.send(JSON.stringify({ t: "sum", f: target, h }));
    }
    // keep the input maps from growing without bound
    if (this.localIn.size > 400) {
      for (const key of this.localIn.keys()) {
        if (key < this.frame - 300) this.localIn.delete(key);
      }
      for (const key of this.remoteIn.keys()) {
        if (key < this.frame - 300) this.remoteIn.delete(key);
      }
    }
  }

  /** Handle a peer packet. Returns true if the peer desynced us. */
  receive(raw: string): boolean {
    let msg: { t?: string; f?: number; m?: number; h?: number; b?: [number, number][] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return false;
    }
    if (msg.t === "in") {
      if (Array.isArray(msg.b)) {
        for (const entry of msg.b) {
          if (Array.isArray(entry) && typeof entry[0] === "number" && typeof entry[1] === "number") {
            this.applyRemote(entry[0], entry[1]);
          }
        }
      }
      if (typeof msg.f === "number" && typeof msg.m === "number") {
        this.applyRemote(msg.f, msg.m);
      }
      return this.desync;
    }
    if (msg.t === "sum" && typeof msg.f === "number" && typeof msg.h === "number") {
      this.remoteChecksums.set(msg.f, msg.h);
      // Only judge a frame that both sides have fully confirmed (all of the
      // peer's inputs up to it have arrived) and that rollback can no longer touch.
      if (msg.f <= this.frame - 2 && msg.f <= this.lastRemoteFrame) {
        const mine = this.hashes.get(msg.f);
        if (mine !== undefined && mine !== msg.h) this.desync = true;
      }
    }
    return this.desync;
  }

  private applyRemote(frame: number, mask: number) {
    this.remoteIn.set(frame, mask);
    if (frame > this.lastRemoteFrame) {
      this.lastRemoteFrame = frame;
      this.lastRemote = mask;
    }
    if (frame > this.frame) return; // future input, nothing to correct yet
    const used = this.usedRemote.get(frame);
    if (used === undefined || used === mask) return;
    this.resimulate(frame);
  }

  private resimulate(from: number) {
    const target = this.frame;
    const snap = this.snaps.get(from - 1);
    if (!snap) return;
    this.state = cloneState(snap);
    this.frame = from - 1;
    for (let f = from; f <= target; f++) {
      const local = this.localIn.get(f);
      if (local === undefined) break;
      this.stepWith(local, f);
    }
    this.rollbacks++;
    this.lastDepth = Math.min(target - from + 1, 40);
  }

  /** Recorded state hash for a simulated frame (undefined if pruned). */
  hashOf(frame: number): number | undefined {
    return this.hashes.get(frame);
  }

  /**
   * Re-apply any input that arrived after its frame was simulated.
   * Used after a burst of late packets (or at the end of a test run) instead of
   * correcting once per packet.
   */
  settle(): void {
    let earliest = -1;
    const floor = Math.max(1, this.frame - 120);
    for (let f = this.frame; f >= floor; f--) {
      const known = this.remoteIn.get(f);
      if (known === undefined || this.usedRemote.get(f) !== known) earliest = f;
    }
    if (earliest > 0) this.resimulate(earliest);
  }

  stats(): RollbackStats {
    let predicted = false;
    for (let f = this.frame - 4; f <= this.frame; f++) {
      if (!this.remoteIn.has(f)) predicted = true;
    }
    return {
      frame: this.frame,
      rollbacks: this.rollbacks,
      lastRollbackDepth: this.lastDepth,
      predicted,
      checksum: stateHash(this.state),
      desync: this.desync,
      remoteLagFrames: Math.max(0, this.frame - this.lastRemoteFrame),
    };
  }
}
