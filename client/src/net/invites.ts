// Direct challenges. A "Duel" press from the lobby roster has to end with the
// other player inside the challenger's room without anyone typing a code.
//
// Path: queue a target -> the online screen opens a room for us -> the room
// layer, the moment it has a code, flushes the queued invite to that player
// through the lobby channel. The recipient gets a banner and accepts.
//
// The challenger is not left guessing: every invite is tracked here until the
// other side answers, and an unanswered one expires on its own.

import { sendLobbyInvite } from "./lobby";

export interface ChallengeIntent {
  id: string;
  name: string;
}

/** Set by the accepting side, read by the online screen after navigation. */
export const AUTOJOIN_KEY = "mvc2online.autojoin";

/** How long a challenge stays open before we call it unanswered. */
export const INVITE_TIMEOUT_MS = 45_000;

export type OutgoingState = "waiting" | "accepted" | "declined" | "busy" | "expired";

export interface OutgoingInvite {
  to: string;
  name: string;
  code: string;
  state: OutgoingState;
}

export interface HeldChallenge {
  to: string;
  name: string;
  /** when it is fair to offer it again */
  readyAt: number;
  /** stop holding after this */
  expiresAt: number;
  /** a match blocked us: wait until we actually see them free again */
  needsFree: boolean;
}

/** How long we keep a blocked or ignored challenge before forgetting it. */
const HOLD_TTL_MS = 10 * 60_000;
/** A player who ignored a challenge gets this much quiet before we offer again. */
const IGNORED_COOLDOWN_MS = 60_000;
/** Grace before acting on a "busy" answer, so their busy state can arrive first. */
const BUSY_GRACE_MS = 2_000;

let intent: ChallengeIntent | null = null;
let outgoing: OutgoingInvite | null = null;
let held: HeldChallenge | null = null;
const heldListeners = new Set<(h: HeldChallenge | null) => void>();
let timer: number | null = null;
const listeners = new Set<(inv: OutgoingInvite | null) => void>();

function emit() {
  for (const fn of listeners) {
    try {
      fn(outgoing);
    } catch (err) {
      console.error("[invite] listener threw", err);
    }
  }
}

/** Subscribe to the challenge we sent; fires immediately with current state. */
export function onOutgoing(fn: (inv: OutgoingInvite | null) => void): () => void {
  listeners.add(fn);
  fn(outgoing);
  return () => listeners.delete(fn);
}

function armTimeout() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    if (!outgoing || outgoing.state !== "waiting") return;
    const target = { to: outgoing.to, name: outgoing.name };
    outgoing = { ...outgoing, state: "expired" };
    emit();
    // Ignored, not refused: after a short quiet spell it is fair to offer again.
    hold(target.to, target.name, Date.now() + IGNORED_COOLDOWN_MS, false);
  }, INVITE_TIMEOUT_MS);
}

/** Send a challenge and start waiting on the answer. */
export function invitePlayer(to: string, name: string, code: string): boolean {
  if (!to || !code) return false;
  if (!sendLobbyInvite(to, code)) return false;
  // A fresh challenge supersedes anything we were holding.
  clearHeld();
  outgoing = { to, name, code: code.trim().toUpperCase(), state: "waiting" };
  emit();
  armTimeout();
  return true;
}

function emitHeld() {
  for (const fn of heldListeners) {
    try {
      fn(held);
    } catch (err) {
      console.error("[invite] held listener threw", err);
    }
  }
}

export function onHeld(fn: (h: HeldChallenge | null) => void): () => void {
  heldListeners.add(fn);
  fn(held);
  return () => heldListeners.delete(fn);
}

function hold(to: string, name: string, readyAt: number, needsFree: boolean) {
  held = { to, name, readyAt, needsFree, expiresAt: Date.now() + HOLD_TTL_MS };
  emitHeld();
}

export function peekHeld(): HeldChallenge | null {
  return held;
}

export function clearHeld() {
  if (!held) return;
  held = null;
  emitHeld();
}

/** Called when a hold has gone stale, so we stop offering it. */
export function expireHeld() {
  if (held && Date.now() >= held.expiresAt) clearHeld();
}

/** The other side answered — or we learned they could not take it. */
export function resolveOutgoing(state: "accepted" | "declined" | "busy", from = "") {
  if (!outgoing || outgoing.state !== "waiting") return;
  // Only the player we challenged can settle this one.
  if (from && outgoing.to && from !== outgoing.to) return;
  const target = { to: outgoing.to, name: outgoing.name };
  outgoing = { ...outgoing, state };
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  emit();
  // Blocked by a match, or nobody answered: keep it so we can offer it again
  // the moment the other player is free. A decline is a no, so we let it drop.
  if (state === "busy") hold(target.to, target.name, Date.now() + BUSY_GRACE_MS, true);
}

export function clearOutgoing() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  outgoing = null;
  emit();
}

export function queueChallenge(target: ChallengeIntent) {
  intent = target;
}

export function peekChallengeIntent(): ChallengeIntent | null {
  return intent;
}

export function dropChallengeIntent() {
  intent = null;
}

/** Called by the room layer as soon as it owns a room code. */
export function flushChallengeInvite(code: string): void {
  const target = intent;
  if (!target || !code) return;
  intent = null;
  invitePlayer(target.id, target.name, code);
}
