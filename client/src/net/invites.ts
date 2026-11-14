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

let intent: ChallengeIntent | null = null;
let outgoing: OutgoingInvite | null = null;
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
    outgoing = { ...outgoing, state: "expired" };
    emit();
  }, INVITE_TIMEOUT_MS);
}

/** Send a challenge and start waiting on the answer. */
export function invitePlayer(to: string, name: string, code: string): boolean {
  if (!to || !code) return false;
  if (!sendLobbyInvite(to, code)) return false;
  outgoing = { to, name, code: code.trim().toUpperCase(), state: "waiting" };
  emit();
  armTimeout();
  return true;
}

/** The other side answered — or we learned they could not take it. */
export function resolveOutgoing(state: "accepted" | "declined" | "busy", from = "") {
  if (!outgoing || outgoing.state !== "waiting") return;
  // Only the player we challenged can settle this one.
  if (from && outgoing.to && from !== outgoing.to) return;
  outgoing = { ...outgoing, state };
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  emit();
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
