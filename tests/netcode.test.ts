// Headless verification of the rollback netcode and simulation determinism.
//
// Two RollbackSessions run the same match on opposite sides, connected by a
// simulated link with latency and packet loss. Inputs are generated per frame,
// delivered late, and both clients must converge on an identical state hash.
//
// Run: npm run test:netcode

import { cloneState, createState, stateHash, stepGame, teamHealth } from "../client/src/game/engine";
import { RollbackSession } from "../client/src/net/rollback";
import { INPUT, type MatchConfig } from "../client/src/game/types";
import { CHAR_INDEX } from "../client/src/game/roster";

const cfgFor = (seed: number): MatchConfig => ({
  teams: [
    [CHAR_INDEX.wolverine, CHAR_INDEX.ryu, CHAR_INDEX.storm],
    [CHAR_INDEX.magneto, CHAR_INDEX.cammy, CHAR_INDEX.ironman],
  ],
  assists: [[0, 0, 0], [1, 0, 1]],
  colors: [[0, 1, 2], [3, 0, 5]],
  stage: 0,
  timer: 99 * 60,
  training: false,
  dummy: 0,
  difficulty: 2,
  seed,
  cpu: false,
});

/** Deterministic pseudo-random input for a player at a frame. */
function inputAt(player: number, frame: number): number {
  let x = (frame * 2654435761 + player * 40503) >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  const r = x % 100;
  if (r < 42) return 0;
  if (r < 58) return INPUT.LP;
  if (r < 66) return INPUT.HP;
  if (r < 74) return INPUT.RIGHT;
  if (r < 80) return INPUT.LEFT;
  if (r < 86) return INPUT.DOWN | INPUT.LK;
  if (r < 90) return INPUT.UP;
  if (r < 94) return INPUT.DOWN | INPUT.RIGHT | INPUT.LP;
  if (r < 97) return INPUT.A1;
  if (r < 99) return INPUT.DOWN | INPUT.RIGHT | INPUT.LP | INPUT.HP;
  return INPUT.DOWN | INPUT.HP;
}

interface Packet {
  at: number;
  to: 0 | 1;
  payload: string;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function runMatch(opts: { latency: number; dropEvery: number; frames: number; seed: number }) {
  const cfg = cfgFor(opts.seed);
  const wire: Packet[] = [];
  const lost: number[] = [0, 0];

  // Seeded loss so the test is reproducible.
  let rng = opts.seed | 0 || 1;
  const nextRandom = () => {
    rng ^= rng << 13; rng |= 0;
    rng ^= rng >>> 17;
    rng ^= rng << 5; rng |= 0;
    return ((rng >>> 0) % 10000) / 10000;
  };

  const mk = (team: 0 | 1, sendLag: number) => {
    const state = createState(cfg);
    return new RollbackSession(cfg, team, state, (payload) => {
      // Simulated packet loss on the unreliable data channel.
      if (opts.dropEvery > 0 && nextRandom() < 1 / opts.dropEvery) {
        lost[team]++;
        return;
      }
      wire.push({ at: currentFrame + sendLag, to: (1 - team) as 0 | 1, payload });
    });
  };

  let currentFrame = 0;
  const a = mk(0, opts.latency);
  // Asymmetric latency, as in a real connection.
  const b = mk(1, Math.max(1, opts.latency - 1));

  for (let f = 1; f <= opts.frames; f++) {
    currentFrame = f;
    a.advance(inputAt(0, f));
    b.advance(inputAt(1, f));

    for (let i = wire.length - 1; i >= 0; i--) {
      const p = wire[i];
      if (p.at <= f) {
        (p.to === 0 ? a : b).receive(p.payload);
        wire.splice(i, 1);
      }
    }
  }

  // Flush the remaining packets so both clients have every input, then resolve
  // any prediction that was left uncorrected.
  wire.sort((p, q) => p.at - q.at);
  for (const p of wire) (p.to === 0 ? a : b).receive(p.payload);
  a.settle();
  b.settle();

  return { a, b, lost, cfg };
}

console.log("MvC2Online — netcode verification\n");

// 1. Determinism: identical inputs stepped twice must produce identical state.
{
  const cfg = cfgFor(1234);
  const s1 = createState(cfg);
  const s2 = createState(cfg);
  for (let f = 1; f <= 400; f++) {
    stepGame(s1, cfg, inputAt(0, f), inputAt(1, f));
    stepGame(s2, cfg, inputAt(0, f), inputAt(1, f));
  }
  check(
    "deterministic resimulation",
    stateHash(s1) === stateHash(s2) && s1.frame === s2.frame,
    `hash ${stateHash(s1).toString(16)} after 400 frames`
  );
  check("timer advances", s1.timer < cfg.timer, `${cfg.timer - s1.timer} frames elapsed`);
  check("no NaN positions in simulation", s1.fighters.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y)));
  void teamHealth;
}

// 1b. Combat really connects: put two fighters adjacent and throw punches.
{
  const cfg = cfgFor(9);
  const s = createState(cfg);
  s.intro = 0;
  s.fighters[0].x = 800;
  s.fighters[3].x = 852;
  s.fighters[0].facing = 1;
  s.fighters[3].facing = -1;
  const before = s.fighters[3].hp;
  let hits = 0;
  for (let f = 0; f < 90; f++) {
    stepGame(s, cfg, INPUT.LP, 0);
    hits = Math.max(hits, s.comboHits);
  }
  check("strikes connect and damage applies", s.fighters[3].hp < before, `${before - s.fighters[3].hp} damage before scaling reset`);
  check("meter is gained from offence", s.fighters[0].meter > 0, `${s.fighters[0].meter} meter`);
  check("combo counter registers hits", hits > 0, `max combo ${hits}`);
}

// 2. Zero latency: lockstep agreement.
{
  const { a, b } = runMatch({ latency: 0, dropEvery: 0, frames: 600, seed: 77 });
  check(
    "state hashes agree (0 ms)",
    stateHash(a.state) === stateHash(b.state),
    `${stateHash(a.state).toString(16)} vs ${stateHash(b.state).toString(16)}, rollbacks ${a.rollbacks}/${b.rollbacks}`
  );
}

// 3. Realistic latency with prediction: rollbacks must fire and converge.
{
  const { a, b, lost } = runMatch({ latency: 4, dropEvery: 0, frames: 900, seed: 991 });
  const same = stateHash(a.state) === stateHash(b.state);
  check(
    "state hashes agree (4 frames latency)",
    same,
    `rollbacks ${a.rollbacks}/${b.rollbacks}, depth ${a.lastDepth}, hash ${stateHash(a.state).toString(16)}`
  );
  check("rollback actually executed", a.rollbacks + b.rollbacks > 0, `${a.rollbacks + b.rollbacks} corrections`);
  void lost;
}

// 4. Latency + packet loss: a dropped input must not desync the match.
// Compared on settled frames: the final few frames of a run may still be
// waiting on an input whose redundant copies were dropped, which is harmless
// in a live match (the very next packet carries it again) but would make a
// tail-of-run comparison meaningless.
{
  const frames = 900;
  const { a, b, lost } = runMatch({ latency: 6, dropEvery: 12, frames, seed: 4242 });
  const settled = frames - 12;
  const ha = a.hashOf(settled);
  const hb = b.hashOf(settled);
  check(
    `state hashes agree at frame ${settled} (6 frames latency, ~8% loss)`,
    ha !== undefined && ha === hb,
    `dropped ${lost[0] + lost[1]} packets, rollbacks ${a.rollbacks}/${b.rollbacks}, ${ha?.toString(16)} vs ${hb?.toString(16)}`
  );
  check("no desync flag raised", !a.desync && !b.desync);

  // A tail-frame mismatch is only acceptable if it is the undelivered-input
  // window; anything wider means a real divergence.
  let agree = 0;
  let total = 0;
  for (let f = 60; f < frames - 12; f += 30) {
    total++;
    if (a.hashOf(f) === b.hashOf(f)) agree++;
  }
  check("history agrees across the whole match", agree === total, `${agree}/${total} sampled frames identical`);
}

// 5. Snapshots are true copies (rollback must not alias live state).
{
  const cfg = cfgFor(5);
  const s = createState(cfg);
  stepGame(s, cfg, INPUT.RIGHT, 0);
  const snap = cloneState(s);
  const before = snap.fighters[0].x;
  for (let i = 0; i < 30; i++) stepGame(s, cfg, INPUT.RIGHT, 0);
  check("snapshot isolation", snap.fighters[0].x === before, `snapshot x ${before} unchanged`);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All netcode checks passed.");
