// Direct challenges. A "Duel" press from the lobby roster has to end with the
// other player inside the challenger's room without anyone typing a code.
//
// Path: queue a target -> the online screen opens a room for us -> the room
// layer, the moment it has a code, flushes the queued invite to that player
// through the lobby channel. The recipient gets a banner and accepts.

import { sendLobbyInvite } from "./lobby";

export interface ChallengeIntent {
  id: string;
  name: string;
}

/** Set by the accepting side, read by the online screen after navigation. */
export const AUTOJOIN_KEY = "mvc2online.autojoin";

let intent: ChallengeIntent | null = null;

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
  sendLobbyInvite(target.id, code);
}
