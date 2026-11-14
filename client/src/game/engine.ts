// Deterministic 60 Hz simulation for a 3v3 tag fighting game built around
// Marvel vs. Capcom 2's rules: three-character teams, one active fighter plus
// assist calls, tag outs, chain combos, launchers into air combos, super jumps,
// pushblock, delayed hyper combos, damage scaling and a 99 second timer.
//
// Determinism contract (this is what makes rollback possible):
//   * fixed 60 Hz step, no time-based deltas
//   * state contains only numbers / booleans / arrays of them
//   * no Math.random, Math.sin, Math.cos, Date or DOM access anywhere below
//   * all randomness comes from state.rng (xorshift32)
// IEEE-754 +,-,*,/ are exactly reproducible, so plain doubles are safe here.

import {
  FS,
  INPUT,
  BUTTONS,
  MAX_METER,
  BAR,
  ROUND_FRAMES,
  WALL_LEFT,
  WALL_RIGHT,
  GRAVITY,
  THROW_RANGE,
  type Fighter,
  type HitDef,
  type MatchConfig,
  type MoveDef,
  type Projectile,
  type SimState,
  type Particle,
} from "./types";
import { ROSTER } from "./roster";

export const M = {
  LP: 0,
  HP: 1,
  LK: 2,
  HK: 3,
  CLP: 4,
  CLK: 5,
  CHP: 6,
  CHK: 7,
  JLP: 8,
  JHP: 9,
  JLK: 10,
  JHK: 11,
  THROW: 12,
  SP1: 13,
  SP2: 14,
  HYP1: 15,
  HYP2: 16,
  ASSIST: 17,
} as const;

const ARCH_MOD: Record<string, { dmg: number; spd: number; reach: number }> = {
  balanced: { dmg: 1.0, spd: 1.0, reach: 1.0 },
  rushdown: { dmg: 0.9, spd: 0.85, reach: 0.95 },
  grappler: { dmg: 1.22, spd: 1.18, reach: 0.96 },
  zoner: { dmg: 0.95, spd: 1.06, reach: 1.1 },
  technical: { dmg: 1.0, spd: 0.95, reach: 1.05 },
};

function H(o: Partial<HitDef> & { dmg: number }): HitDef {
  return {
    dmg: o.dmg,
    hitstun: o.hitstun ?? 14,
    blockstun: o.blockstun ?? 9,
    level: o.level ?? 0,
    hitstop: o.hitstop ?? 5,
    push: o.push ?? 3,
    launch: o.launch ?? 0,
    knockdown: o.knockdown ?? false,
    meter: o.meter ?? 5,
    group: o.group ?? 0,
  };
}

interface MoveSpec extends Partial<MoveDef> {
  id: string;
  name: string;
  startup: number;
  active: number;
  recovery: number;
  hx: number;
  hy: number;
  hw: number;
  hh: number;
  hit: HitDef;
}

function mk(spec: MoveSpec): MoveDef {
  return {
    id: spec.id,
    name: spec.name,
    startup: spec.startup,
    active: spec.active,
    recovery: spec.recovery,
    hx: spec.hx,
    hy: spec.hy,
    hw: spec.hw,
    hh: spec.hh,
    vx: spec.vx ?? 0,
    vy: spec.vy ?? 0,
    air: spec.air ?? false,
    low: spec.low ?? false,
    overhead: spec.overhead ?? false,
    hits: spec.hits ?? 1,
    interval: spec.interval ?? 6,
    hit: spec.hit,
    proj: spec.proj ?? null,
    invuln: spec.invuln ?? 0,
    cost: spec.cost ?? 0,
    hyper: spec.hyper ?? false,
    cancels: spec.cancels ?? [],
  };
}

const moveCache = new Map<number, MoveDef[]>();

export function movesFor(charIdx: number): MoveDef[] {
  const cached = moveCache.get(charIdx);
  if (cached) return cached;
  const c = ROSTER[charIdx] ?? ROSTER[0];
  const a = ARCH_MOD[c.arch] ?? ARCH_MOD.balanced;
  const sp = (n: number) => Math.max(2, Math.round(n * a.spd));
  const reach = (n: number) => Math.round(n * a.reach);
  const dmg = (n: number) => Math.round(n * a.dmg);

  const normals: MoveDef[] = [
    mk({ id: "lp", name: "Light Punch", startup: sp(4), active: 2, recovery: sp(8), hx: reach(34), hy: 82, hw: reach(60), hh: 34, hit: H({ dmg: dmg(26), hitstun: 13, blockstun: 9, hitstop: 4, push: 2 }) }),
    mk({ id: "hp", name: "Heavy Punch", startup: sp(8), active: 3, recovery: sp(14), hx: reach(42), hy: 84, hw: reach(74), hh: 42, hit: H({ dmg: dmg(68), hitstun: 17, blockstun: 11, hitstop: 6, push: 4, meter: 7 }) }),
    mk({ id: "lk", name: "Light Kick", startup: sp(5), active: 2, recovery: sp(9), hx: reach(36), hy: 48, hw: reach(64), hh: 30, hit: H({ dmg: dmg(30), hitstun: 14, blockstun: 9, hitstop: 4, push: 2 }) }),
    mk({ id: "hk", name: "Heavy Kick", startup: sp(9), active: 3, recovery: sp(16), hx: reach(46), hy: 62, hw: reach(84), hh: 46, hit: H({ dmg: dmg(74), hitstun: 18, blockstun: 12, hitstop: 7, push: 5, meter: 7 }) }),
    mk({ id: "clp", name: "Crouch Light Punch", startup: sp(4), active: 2, recovery: sp(8), hx: reach(34), hy: 52, hw: reach(58), hh: 30, hit: H({ dmg: dmg(24), hitstun: 13, blockstun: 9, hitstop: 4, push: 2 }) }),
    mk({ id: "clk", name: "Low Light Kick", startup: sp(5), active: 2, recovery: sp(9), hx: reach(38), hy: 26, hw: reach(64), hh: 26, low: true, hit: H({ dmg: dmg(26), hitstun: 14, blockstun: 9, hitstop: 4, push: 2, level: 1 }) }),
    mk({ id: "chp", name: "Launcher", startup: sp(8), active: 3, recovery: sp(16), hx: reach(38), hy: 44, hw: reach(70), hh: 62, hit: H({ dmg: dmg(58), hitstun: 26, blockstun: 12, hitstop: 7, push: 1, launch: 11, meter: 8 }) }),
    mk({ id: "chk", name: "Sweep", startup: sp(9), active: 3, recovery: sp(17), hx: reach(44), hy: 22, hw: reach(80), hh: 24, low: true, hit: H({ dmg: dmg(52), hitstun: 18, blockstun: 12, hitstop: 7, push: 4, level: 1, knockdown: true, meter: 7 }) }),
    mk({ id: "jlp", name: "Air Light Punch", startup: sp(4), active: 6, recovery: sp(6), hx: reach(36), hy: -20, hw: reach(60), hh: 40, air: true, overhead: true, hit: H({ dmg: dmg(26), hitstun: 14, blockstun: 9, hitstop: 4, push: 2, level: 2 }) }),
    mk({ id: "jhp", name: "Air Heavy Punch", startup: sp(7), active: 6, recovery: sp(10), hx: reach(42), hy: -24, hw: reach(74), hh: 46, air: true, overhead: true, hit: H({ dmg: dmg(64), hitstun: 18, blockstun: 11, hitstop: 6, push: 3, level: 2, meter: 7 }) }),
    mk({ id: "jlk", name: "Air Light Kick", startup: sp(5), active: 6, recovery: sp(7), hx: reach(38), hy: -34, hw: reach(64), hh: 36, air: true, overhead: true, hit: H({ dmg: dmg(28), hitstun: 14, blockstun: 9, hitstop: 4, push: 2, level: 2 }) }),
    mk({ id: "jhk", name: "Air Heavy Kick", startup: sp(8), active: 6, recovery: sp(11), hx: reach(44), hy: -30, hw: reach(80), hh: 42, air: true, overhead: true, hit: H({ dmg: dmg(68), hitstun: 18, blockstun: 12, hitstop: 7, push: 3, level: 2, meter: 7 }) }),
    mk({ id: "throw", name: "Throw", startup: 4, active: 2, recovery: 16, hx: 40, hy: 70, hw: 60, hh: 80, hit: H({ dmg: dmg(90), hitstun: 30, blockstun: 0, hitstop: 8, push: 0, knockdown: true, meter: 8 }) }),
  ];

  // ---- specials by archetype ----
  const projSpecial = (name: string): MoveDef =>
    mk({
      id: "sp1",
      name,
      startup: sp(11),
      active: 3,
      recovery: sp(26),
      hx: 60,
      hy: 70,
      hw: 80,
      hh: 80,
      proj: { speed: c.proj ? 7.2 : 6.0, life: 92, w: 34, h: 30, dmg: dmg(48), delay: sp(8) },
      hit: H({ dmg: dmg(48), hitstun: 16, blockstun: 12, hitstop: 5, push: 4, meter: 8 }),
    });

  const rushSpecial = (name: string): MoveDef =>
    mk({
      id: "sp1",
      name,
      startup: sp(9),
      active: 6,
      recovery: sp(20),
      hx: reach(46),
      hy: 66,
      hw: reach(78),
      hh: 70,
      vx: 5.2,
      hit: H({ dmg: dmg(72), hitstun: 20, blockstun: 12, hitstop: 6, push: 6, knockdown: true, meter: 9 }),
    });

  const grabSpecial = (name: string): MoveDef =>
    mk({
      id: "sp1",
      name,
      startup: sp(7),
      active: 4,
      recovery: sp(30),
      hx: reach(30),
      hy: 66,
      hw: reach(56),
      hh: 80,
      invuln: 4,
      hit: H({ dmg: dmg(120), hitstun: 34, blockstun: 0, hitstop: 9, push: 0, knockdown: true, level: 3, meter: 12 }),
    });

  const dpSpecial = (name: string): MoveDef =>
    mk({
      id: "sp2",
      name,
      startup: sp(5),
      active: 8,
      recovery: sp(22),
      hx: reach(28),
      hy: 96,
      hw: reach(58),
      hh: 96,
      vy: 9.4,
      invuln: 6,
      hit: H({ dmg: dmg(80), hitstun: 24, blockstun: 12, hitstop: 7, push: 4, launch: 9, meter: 10 }),
    });

  const slamSpecial = (name: string): MoveDef =>
    mk({
      id: "sp2",
      name,
      startup: sp(12),
      active: 5,
      recovery: sp(24),
      hx: reach(50),
      hy: 60,
      hw: reach(90),
      hh: 76,
      hit: H({ dmg: dmg(95), hitstun: 26, blockstun: 13, hitstop: 8, push: 7, knockdown: true, meter: 10 }),
    });

  const trapSpecial = (name: string): MoveDef =>
    mk({
      id: "sp1",
      name,
      startup: sp(13),
      active: 3,
      recovery: sp(24),
      hx: 70,
      hy: 60,
      hw: 90,
      hh: 90,
      proj: { speed: 3.4, life: 130, w: 38, h: 38, dmg: dmg(40), delay: sp(10) },
      hit: H({ dmg: dmg(40), hitstun: 20, blockstun: 12, hitstop: 5, push: 2, meter: 8 }),
    });

  let sp1: MoveDef;
  let sp2: MoveDef;
  switch (c.arch) {
    case "grappler":
      sp1 = grabSpecial(c.sp[0]);
      sp2 = slamSpecial(c.sp[1]);
      break;
    case "rushdown":
      sp1 = rushSpecial(c.sp[0]);
      sp2 = dpSpecial(c.sp[1]);
      break;
    case "zoner":
      sp1 = projSpecial(c.sp[0]);
      sp2 = dpSpecial(c.sp[1]);
      break;
    case "technical":
      sp1 = trapSpecial(c.sp[0]);
      sp2 = dpSpecial(c.sp[1]);
      break;
    default:
      sp1 = c.proj ? projSpecial(c.sp[0]) : rushSpecial(c.sp[0]);
      sp2 = dpSpecial(c.sp[1]);
      break;
  }

  // ---- hypers ----
  const hypers: MoveDef[] = [
    mk({
      id: "hyp1",
      name: c.sp[2],
      startup: sp(9),
      active: 20,
      recovery: sp(30),
      hx: 70,
      hy: 76,
      hw: 120,
      hh: 110,
      invuln: 10,
      hyper: true,
      cost: BAR,
      hits: 5,
      interval: 4,
      hit: H({ dmg: dmg(52), hitstun: 22, blockstun: 14, hitstop: 4, push: 2, launch: 6, meter: 0, group: 1 }),
    }),
    mk({
      id: "hyp2",
      name: c.sp[2] + " EX",
      startup: sp(11),
      active: 26,
      recovery: sp(36),
      hx: 80,
      hy: 70,
      hw: 150,
      hh: 130,
      invuln: 12,
      hyper: true,
      cost: BAR * 2,
      hits: 9,
      interval: 3,
      hit: H({ dmg: dmg(38), hitstun: 20, blockstun: 14, hitstop: 3, push: 1, launch: 4, meter: 0, group: 2 }),
    }),
  ];

  const assistMv: MoveDef = {
    ...sp1,
    id: "assist",
    name: sp1.name + " (Assist)",
    cost: 0,
    hits: 1,
    invuln: 0,
    hyper: false,
    hit: { ...sp1.hit, dmg: Math.round(sp1.hit.dmg * 0.72), meter: 6 },
  };

  const all = [...normals, sp1, sp2, ...hypers, assistMv];
  moveCache.set(charIdx, all);
  return all;
}

/** The move a partner performs when called as an assist. */
export function assistMoveFor(charIdx: number): MoveDef {
  return movesFor(charIdx)[M.ASSIST];
}

// ------------------------------------------------------------------ state
function newFighter(char: number, team: number, slot: number): Fighter {
  const def = ROSTER[char] ?? ROSTER[0];
  return {
    char,
    team,
    slot,
    hp: def.hp,
    maxHp: def.hp,
    meter: 0,
    x: team === 0 ? 520 : 1080,
    y: 0,
    vx: 0,
    vy: 0,
    facing: team === 0 ? 1 : -1,
    st: FS.INTRO,
    stFrame: 0,
    hitstun: 0,
    blockstun: 0,
    hitstop: 0,
    move: -1,
    moveFrame: 0,
    moveHits: 0,
    nextHit: 0,
    hitGroups: 0,
    invuln: 0,
    airborne: false,
    crouch: false,
    blocking: false,
    ko: false,
    comboCount: 0,
    comboDmg: 0,
    active: slot === 0,
    onScreen: slot === 0,
    assistCd: 0,
    hasHit: false,
    airHits: 0,
    tagLock: 0,
    flash: 0,
    qcf: 0,
    qcb: 0,
    dp: 0,
    fwd: 0,
    dwn: 0,
    chB: 0,
    chD: 0,
    chBF: 0,
    chDU: 0,
    sj: 0,
    prev: 0,
    pushed: 0,
  };
}

export function createState(cfg: MatchConfig): SimState {
  const fighters: Fighter[] = [];
  for (let t = 0; t < 2; t++) {
    for (let s = 0; s < 3; s++) {
      fighters.push(newFighter(cfg.teams[t]?.[s] ?? 0, t, s));
    }
  }
  const s: SimState = {
    frame: 0,
    timer: cfg.timer,
    fighters,
    projectiles: [],
    particles: [],
    active: [0, 0],
    incoming: [-1, -1],
    incomingTimer: 0,
    intro: 70,
    over: false,
    winner: -1,
    hitstop: 0,
    shake: 0,
    hitsparkX: 0,
    hitsparkY: 0,
    hitsparkLife: 0,
    comboTeam: -1,
    comboHits: 0,
    announce: 1,
    announceLife: 70,
    assistCall: [-1, -1],
    paused: false,
    rng: 0,
    lastComboDmg: 0,
  };
  initRng(s, cfg.seed);
  return s;
}

export function activeFighter(s: SimState, team: number): Fighter {
  return s.fighters[team * 3 + s.active[team]];
}

function rnd(s: SimState): number {
  // xorshift32 — deterministic, lives in state so rollback reproduces it
  let x = s.rng | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x | 0;
  return (x >>> 0) / 4294967296;
}

function initRng(s: SimState, seed: number) {
  s.rng = (seed | 0) || 0x9e3779b9;
  if (s.rng === 0) s.rng = 0x9e3779b9;
}

export function spawnParticles(s: SimState, x: number, y: number, kind: number, n: number, color: number) {
  for (let i = 0; i < n; i++) {
    if (s.particles.length > 160) s.particles.shift();
    const a = rnd(s) * 6.28318;
    const sp = 1.5 + rnd(s) * 4;
    s.particles.push({
      alive: true,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + (kind === 1 ? 1.5 : 0),
      life: 10 + Math.floor(rnd(s) * 12),
      maxLife: 22,
      kind,
      size: 2 + rnd(s) * (kind === 2 ? 7 : 3),
      color,
    });
  }
}

// ------------------------------------------------------------- hitboxes
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hurtbox(f: Fighter): Box {
  const h = f.crouch ? 78 : 116;
  return { x: f.x - 25, y: f.y, w: 50, h };
}

function hitbox(f: Fighter, mv: MoveDef): Box {
  const cx = f.x + f.facing * mv.hx;
  const cy = f.y + mv.hy;
  return { x: cx - mv.hw / 2, y: cy - mv.hh / 2, w: mv.hw, h: mv.hh };
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------------------------------------------------------- move handling
function startMove(s: SimState, f: Fighter, idx: number, moves: MoveDef[]) {
  const mv = moves[idx];
  if (!mv) return;
  f.move = idx;
  f.moveFrame = 0;
  f.moveHits = 0;
  f.hasHit = false;
  f.nextHit = mv.startup;
  f.st = FS.ATTACK;
  f.stFrame = 0;
  if (mv.invuln > 0) f.invuln = mv.invuln;
  if (mv.vx !== 0) f.vx = f.facing * mv.vx;
  if (mv.vy !== 0) {
    f.vy = mv.vy;
    f.airborne = true;
  }
  if (mv.cost > 0) f.meter = Math.max(0, f.meter - mv.cost);
  if (mv.hyper) {
    s.announce = 4;
    s.announceLife = 26;
    spawnParticles(s, f.x, f.y + 70, 2, 14, 0xffd166);
  }
}

function endMove(f: Fighter) {
  f.move = -1;
  f.moveFrame = 0;
  f.moveHits = 0;
  f.hasHit = false;
  f.st = f.airborne ? FS.JUMP : FS.IDLE;
  f.stFrame = 0;
}

/** Which special (1 or 2) the buffered motions allow, 0 for none. */
function motionSpecial(f: Fighter, sp1MotionCharge: boolean): number {
  if (f.qcf > 0 || f.chBF > 0) return 1;
  if (f.qcb > 0) return 1;
  if (f.dp > 0 || f.chDU > 0) return 2;
  return sp1MotionCharge ? 1 : 0;
}

function clearMotion(f: Fighter) {
  f.qcf = 0;
  f.qcb = 0;
  f.dp = 0;
  f.chBF = 0;
  f.chDU = 0;
}

function updateMotion(f: Fighter, inp: number) {
  if (f.qcf > 0) f.qcf--;
  if (f.qcb > 0) f.qcb--;
  if (f.dp > 0) f.dp--;
  if (f.fwd > 0) f.fwd--;
  if (f.dwn > 0) f.dwn--;
  if (f.sj > 0) f.sj--;
  if (f.chBF > 0) f.chBF--;
  if (f.chDU > 0) f.chDU--;

  const fwKey = f.facing > 0 ? INPUT.RIGHT : INPUT.LEFT;
  const bkKey = f.facing > 0 ? INPUT.LEFT : INPUT.RIGHT;
  const up = (inp & INPUT.UP) !== 0;
  const dn = (inp & INPUT.DOWN) !== 0;
  const fwd = (inp & fwKey) !== 0;
  const back = (inp & bkKey) !== 0;

  if (dn) f.dwn = 8;
  if (fwd) f.fwd = 8;
  if (f.dwn > 0 && fwd) f.qcf = 7;
  if (f.dwn > 0 && back) f.qcb = 7;
  if (f.fwd > 0 && dn) f.dp = 7;
  if (f.dwn > 0 && up) f.sj = 6;

  if (back && !dn) f.chB = Math.min(60, f.chB + 1);
  else f.chB = Math.max(0, f.chB - 2);
  if (dn && !fwd && !back) f.chD = Math.min(60, f.chD + 1);
  else f.chD = Math.max(0, f.chD - 2);
  if (f.chB >= 32 && fwd) f.chBF = 5;
  if (f.chD >= 32 && up) f.chDU = 5;
}

// -------------------------------------------------------------- assists
function partnerSlot(s: SimState, f: Fighter): number {
  for (let i = 1; i <= 2; i++) {
    const slot = (f.slot + i) % 3;
    const p = s.fighters[f.team * 3 + slot];
    if (!p.ko) return slot;
  }
  return -1;
}

function callAssist(s: SimState, f: Fighter, which: number): boolean {
  if (f.assistCd > 0 || !f.active) return false;
  const slots = [partnerSlot(s, f)];
  const second = partnerSlot(s, { ...f, slot: slots[0] } as Fighter);
  if (which === 2 && second >= 0) slots[0] = second;
  const slot = slots[0];
  if (slot < 0) return false;
  const p = s.fighters[f.team * 3 + slot];
  if (p.onScreen || p.ko) return false;
  p.onScreen = true;
  p.st = FS.ASSIST;
  p.stFrame = 0;
  p.x = f.team === 0 ? WALL_LEFT + 40 : WALL_RIGHT - 40;
  p.y = 0;
  p.airborne = false;
  p.facing = f.facing;
  p.vx = f.facing * 6.5;
  p.move = -1;
  p.invuln = 8;
  f.assistCd = 260;
  s.assistCall[f.team] = slot;
  return true;
}

function tagOut(s: SimState, f: Fighter): boolean {
  if (f.tagLock > 0 || !f.active || f.airborne) return false;
  const slot = partnerSlot(s, f);
  if (slot < 0) return false;
  const p = s.fighters[f.team * 3 + slot];
  f.active = false;
  f.onScreen = false;
  f.move = -1;
  f.st = FS.IDLE;
  s.active[f.team] = slot;
  p.active = true;
  p.onScreen = true;
  p.x = f.x;
  p.y = 0;
  p.vx = 0;
  p.vy = 0;
  p.facing = f.facing;
  p.st = FS.INTRO;
  p.stFrame = 0;
  p.tagLock = 18;
  p.hitstun = 0;
  p.blockstun = 0;
  p.invuln = 16;
  spawnParticles(s, p.x, p.y + 60, 2, 10, 0x7df9ff);
  return true;
}

// ------------------------------------------------------------ input
function processInput(s: SimState, f: Fighter, inp: number, moves: MoveDef[]) {
  if (f.ko || !f.onScreen) return;
  if (f.invuln > 0) f.invuln--;
  if (f.tagLock > 0) f.tagLock--;
  if (f.assistCd > 0) f.assistCd--;
  if (f.flash > 0) f.flash--;

  const pressed = inp & BUTTONS & ~f.prev;
  f.prev = inp & BUTTONS;

  const fwKey = f.facing > 0 ? INPUT.RIGHT : INPUT.LEFT;
  const bkKey = f.facing > 0 ? INPUT.LEFT : INPUT.RIGHT;
  f.blocking = false;

  if (f.st === FS.ASSIST) return;

  // ---- locked in hitstun / blockstun ----
  if (f.hitstun > 0 || f.st === FS.HITSTUN) {
    updateMotion(f, inp);
    f.hitstun--;
    f.st = FS.HITSTUN;
    // pushblock: HP+HK during blockstun
    if (f.blockstun > 0 && (pressed & INPUT.HP) && (pressed & INPUT.HK)) {
      f.blockstun = 0;
      f.hitstun = 0;
      f.pushed = 12;
      f.x -= f.facing * 26;
      spawnParticles(s, f.x + f.facing * 30, f.y + 60, 0, 6, 0x9be9ff);
    }
    if (f.blockstun > 0) f.blockstun--;
    if (f.hitstun <= 0 && f.blockstun <= 0) {
      f.st = f.airborne ? FS.JUMP : FS.IDLE;
      f.comboCount = 0;
    }
    return;
  }
  if (f.blockstun > 0) {
    f.blockstun--;
    f.st = FS.BLOCKSTUN;
    updateMotion(f, inp);
    return;
  }

  // ---- knock down / wake up ----
  if (f.st === FS.KNOCKDOWN) {
    f.stFrame++;
    if (!f.airborne && f.stFrame > 26) {
      f.st = FS.WAKEUP;
      f.stFrame = 0;
      f.invuln = 6;
    }
    return;
  }
  if (f.st === FS.WAKEUP) {
    f.stFrame++;
    if (f.stFrame > 14) {
      f.st = FS.IDLE;
      f.stFrame = 0;
    }
    return;
  }

  updateMotion(f, inp);

  // ---- attacking: allow cancels ----
  if (f.st === FS.ATTACK) {
    const mv = moves[f.move];
    if (mv) {
      const canCancel = f.hasHit && f.moveFrame >= mv.startup;
      if (canCancel) {
        const heavy = pressed & (INPUT.HP | INPUT.HK);
        if (heavy) {
          const target = mv.air ? (pressed & INPUT.HP ? M.JHP : M.JHK) : pressed & INPUT.HP ? M.HP : M.HK;
          startMove(s, f, target, moves);
          clearMotion(f);
          return;
        }
        const special = motionSpecial(f, false);
        if (special && (pressed & BUTTONS)) {
          const idx = special === 1 ? M.SP1 : M.SP2;
          if (mv.air && !moves[idx].air) {
            // specials are grounded-only except DP; ignore in air
          } else {
            startMove(s, f, idx, moves);
            clearMotion(f);
            return;
          }
        }
      }
    }
    return; // otherwise ride the move out in tickMove
  }

  // ---- free actions ----
  const lp = (pressed & INPUT.LP) !== 0;
  const hp = (pressed & INPUT.HP) !== 0;
  const lk = (pressed & INPUT.LK) !== 0;
  const hk = (pressed & INPUT.HK) !== 0;
  const anyBtn = (pressed & BUTTONS) !== 0;

  // tag: LP+LK
  if (lp && lk && !f.airborne) {
    if (tagOut(s, f)) return;
  }
  // assists
  if (pressed & INPUT.A1) {
    if (callAssist(s, f, 1)) return;
  }
  if (pressed & INPUT.A2) {
    if (callAssist(s, f, 2)) return;
  }

  // hypers: LP+HP or LK+HK with a motion
  const hyperBtn = (lp && hp) || (lk && hk);
  if (hyperBtn) {
    const charged = f.qcf > 0 || f.qcb > 0;
    const idx = lp && hp ? M.HYP1 : M.HYP2;
    const hyper = moves[idx];
    if (charged && f.meter >= hyper.cost) {
      startMove(s, f, idx, moves);
      clearMotion(f);
      return;
    }
  }

  // specials
  const sp = motionSpecial(f, false);
  if (sp && anyBtn && !(lp && lk)) {
    const idx = sp === 1 ? M.SP1 : M.SP2;
    const special = moves[idx];
    if (!f.airborne || special.id === "sp2") {
      startMove(s, f, idx, moves);
      clearMotion(f);
      return;
    }
  }

  if (f.airborne) {
    // air normals
    if (lp) { startMove(s, f, M.JLP, moves); return; }
    if (hp) { startMove(s, f, M.JHP, moves); return; }
    if (lk) { startMove(s, f, M.JLK, moves); return; }
    if (hk) { startMove(s, f, M.JHK, moves); return; }
    return;
  }

  // jump (up, or super jump after a down tap)
  if (inp & INPUT.UP) {
    const def = ROSTER[f.char];
    f.vy = (f.sj > 0 ? def.jump * 1.32 : def.jump);
    f.vx = (inp & fwKey ? def.walkF * 0.9 : inp & bkKey ? -def.walkB * 0.9 : 0);
    f.airborne = true;
    f.st = FS.JUMP;
    f.crouch = false;
    if (f.sj > 0) spawnParticles(s, f.x, f.y, 1, 6, 0xffffff);
    f.sj = 0;
    return;
  }

  // throw
  if (hp) {
    const opp = activeFighter(s, 1 - f.team);
    if (!f.airborne && Math.abs(opp.x - f.x) <= THROW_RANGE && !opp.airborne && opp.hitstun <= 0) {
      startMove(s, f, M.THROW, moves);
      return;
    }
  }

  const crouching = (inp & INPUT.DOWN) !== 0 && !f.airborne;
  f.crouch = crouching;

  if (lp) { startMove(s, f, crouching ? M.CLP : M.LP, moves); return; }
  if (hp) { startMove(s, f, crouching ? M.CHP : M.HP, moves); return; }
  if (lk) { startMove(s, f, crouching ? M.CLK : M.LK, moves); return; }
  if (hk) { startMove(s, f, crouching ? M.CHK : M.HK, moves); return; }

  // ---- movement ----
  const def = ROSTER[f.char];
  if (crouching) {
    f.st = FS.CROUCH;
    f.vx = 0;
    f.blocking = (inp & bkKey) !== 0;
  } else if (inp & fwKey) {
    f.st = FS.WALK_F;
    f.vx = def.walkF;
  } else if (inp & bkKey) {
    f.st = FS.WALK_B;
    f.vx = -def.walkB;
    f.blocking = true;
  } else {
    f.st = FS.IDLE;
    f.vx = 0;
  }
}

// ------------------------------------------------------------- combat
function scaleDamage(comboCount: number): number {
  return Math.max(0.18, 1 - 0.11 * comboCount);
}

function applyHit(
  s: SimState,
  attacker: Fighter,
  defender: Fighter,
  mv: MoveDef,
  dmgOverride: number | null,
  group: number
) {
  if (defender.ko || !defender.onScreen) return;
  if (defender.invuln > 0) return;

  const h = mv.hit;
  const blockingPossible =
    h.level !== 3 &&
    defender.blocking &&
    (defender.hitstun <= 0 || defender.blockstun > 0) &&
    !(h.level === 1 && !defender.crouch) &&
    !(h.level === 2 && defender.crouch);

  const baseDmg = dmgOverride ?? h.dmg;
  const scale = scaleDamage(defender.comboCount);
  const dmg = Math.max(1, Math.round(baseDmg * scale));

  s.hitstop = h.hitstop;
  s.shake = Math.max(s.shake, h.hitstop * 1.6);
  s.hitsparkX = defender.x;
  s.hitsparkY = defender.y + 66;
  s.hitsparkLife = 12;

  if (blockingPossible) {
    defender.blockstun = h.blockstun;
    defender.st = FS.BLOCKSTUN;
    defender.hitstun = 0;
    defender.hp -= Math.max(1, Math.round(dmg * 0.14));
    defender.meter = Math.min(MAX_METER, defender.meter + 2);
    attacker.meter = Math.min(MAX_METER, attacker.meter + Math.round(h.meter * 0.35));
    defender.x -= attacker.facing * h.push;
    spawnParticles(s, defender.x + attacker.facing * 24, defender.y + 60, 0, 4, 0x9be9ff);
  } else {
    defender.hp -= dmg;
    defender.hitstun = h.hitstun;
    defender.st = FS.HITSTUN;
    defender.blockstun = 0;
    defender.comboCount++;
    defender.comboDmg += dmg;
    defender.flash = 6;
    attacker.meter = Math.min(MAX_METER, attacker.meter + h.meter);
    defender.meter = Math.min(MAX_METER, defender.meter + 3);
    s.comboTeam = defender.team;
    s.comboHits = defender.comboCount;
    s.lastComboDmg = defender.comboDmg;

    if (h.launch > 0) {
      defender.vy = h.launch;
      defender.airborne = true;
      defender.airHits = 0;
      defender.st = FS.HITSTUN;
    }
    if (h.knockdown) {
      defender.airborne = true;
      defender.st = FS.KNOCKDOWN;
      defender.stFrame = 0;
      defender.vy = Math.max(defender.vy, 7);
      defender.vx = attacker.facing * 2.5;
    }
    if (defender.airborne && h.launch === 0 && !h.knockdown) {
      defender.airHits++;
      defender.vy = Math.min(defender.vy, 2.2);
      if (defender.airHits >= 5) {
        defender.st = FS.KNOCKDOWN;
        defender.stFrame = 0;
        defender.airborne = true;
        defender.vy = 4;
      }
    }

    defender.x -= attacker.facing * h.push * 0.6;
    defender.vx = -attacker.facing * (h.push * 0.4);
    spawnParticles(s, s.hitsparkX, s.hitsparkY, 0, h.dmg > 60 ? 10 : 6, 0xffe066);
    s.hitsparkLife = 10;
  }

  attacker.hasHit = true;
  attacker.moveHits++;

  if (defender.hp <= 0) {
    defender.hp = 0;
    if (defender.active) {
      defender.ko = true;
      defender.st = FS.KO;
      defender.stFrame = 0;
      defender.vy = 6;
      defender.airborne = true;
      defender.vx = -attacker.facing * 3;
      s.announce = 2;
      s.announceLife = 60;
      s.hitstop = 16;
      s.shake = 22;
      spawnParticles(s, defender.x, defender.y + 60, 2, 26, 0xff5c7a);
      nextCharacter(s, defender.team);
    } else {
      defender.hp = 1; // assists cannot be KO'd in this engine (documented)
    }
  }
}

function nextCharacter(s: SimState, team: number) {
  for (let i = 1; i <= 3; i++) {
    const slot = (s.active[team] + i) % 3;
    const f = s.fighters[team * 3 + slot];
    if (!f.ko) {
      s.incoming[team] = slot;
      s.incomingTimer = 96;
      return;
    }
  }
  s.incoming[team] = -1;
  s.over = true;
  s.winner = 1 - team;
  s.announce = 3;
  s.announceLife = 200;
}

// ------------------------------------------------------------- physics
function physics(f: Fighter) {
  if (f.ko && f.y <= 0) {
    f.y = 0;
    f.vy = 0;
    f.vx *= 0.8;
  }
  f.x += f.vx;
  f.y += f.vy;
  if (f.airborne || f.y > 0) {
    f.vy -= GRAVITY;
    if (f.y <= 0) {
      f.y = 0;
      if (f.st === FS.KNOCKDOWN) {
        f.vy = 0;
        f.vx = 0;
        f.airborne = false;
        f.airHits = 0;
        f.stFrame = 0;
      } else if (f.st === FS.KO) {
        f.vy = 0;
        f.airborne = false;
      } else {
        f.vy = 0;
        f.airborne = false;
        f.airHits = 0;
        if (f.st === FS.JUMP) {
          f.st = FS.LAND;
          f.stFrame = 0;
        }
        if (f.hitstun > 0) {
          f.hitstun = 0;
          f.st = FS.LAND;
          f.stFrame = 0;
          f.comboCount = 0;
        }
      }
    }
  }
  if (f.st === FS.LAND) {
    f.stFrame++;
    if (f.stFrame > 4) {
      f.st = FS.IDLE;
      f.stFrame = 0;
    }
  }
  const minX = WALL_LEFT + 26;
  const maxX = WALL_RIGHT - 26;
  if (f.x < minX) { f.x = minX; if (f.vx < 0) f.vx = 0; }
  if (f.x > maxX) { f.x = maxX; if (f.vx > 0) f.vx = 0; }
}

function tickMoveBody(s: SimState, f: Fighter, moves: MoveDef[]) {
  if (f.st !== FS.ATTACK) return;
  const mv = moves[f.move];
  if (!mv) {
    endMove(f);
    return;
  }
  f.moveFrame++;
  const total = mv.startup + mv.active + mv.recovery;
  if (f.airborne && mv.air === false && mv.id !== "sp2" && mv.vy === 0 && !mv.hyper) {
    // grounded normals cannot continue once airborne
    if (f.moveFrame > mv.startup) {
      endMove(f);
      return;
    }
  }
  // projectile spawn
  if (mv.proj && f.moveFrame === mv.proj.delay) {
    s.projectiles.push({
      alive: true,
      owner: f.team * 3 + f.slot,
      team: f.team,
      x: f.x + f.facing * 40,
      y: f.y + 62,
      vx: f.facing * mv.proj.speed,
      w: mv.proj.w,
      h: mv.proj.h,
      life: mv.proj.life,
      dmg: mv.proj.dmg,
      hitstop: 5,
      hitstun: 16,
      blockstun: 12,
      group: 3,
    });
  }
  if (f.moveFrame >= total) endMove(f);
}

// ------------------------------------------------------------ combat pass
function combatPass(s: SimState) {
  for (let team = 0; team < 2; team++) {
    for (let slot = 0; slot < 3; slot++) {
      const f = s.fighters[team * 3 + slot];
      if (!f.onScreen || f.ko) continue;
      const moves = movesFor(f.char);
      if (f.st === FS.ASSIST) continue;
      if (f.st !== FS.ATTACK) continue;
      const mv = moves[f.move];
      if (!mv) continue;
      if (f.moveFrame < mv.startup) continue;
      if (f.moveFrame >= mv.startup + mv.active) continue;
      if (f.moveHits >= mv.hits) continue;
      if (f.moveFrame < f.nextHit) continue;

      const hb = hitbox(f, mv);
      for (let os = 0; os < 3; os++) {
        const d = s.fighters[(1 - team) * 3 + os];
        if (!d.onScreen || d.ko || d.invuln > 0) continue;
        if (!overlap(hb, hurtbox(d))) continue;
        applyHit(s, f, d, mv, null, mv.hit.group);
        f.nextHit = f.moveFrame + mv.interval;
        if (f.moveHits >= mv.hits) break;
      }
    }
  }
}

function projectilePass(s: SimState) {
  for (const p of s.projectiles) {
    if (!p.alive) continue;
    p.x += p.vx;
    p.life--;
    if (p.life <= 0 || p.x < WALL_LEFT || p.x > WALL_RIGHT) p.alive = false;
    if (!p.alive) continue;
    const pb = { x: p.x - p.w / 2, y: p.y, w: p.w, h: p.h };
    for (let os = 0; os < 3; os++) {
      const d = s.fighters[(1 - p.team) * 3 + os];
      if (!d.onScreen || d.ko || d.invuln > 0) continue;
      if (!overlap(pb, hurtbox(d))) continue;
      const fake: MoveDef = {
        ...movesFor(s.fighters[p.owner].char)[0],
        hit: {
          dmg: p.dmg,
          hitstun: p.hitstun,
          blockstun: p.blockstun,
          level: 0,
          hitstop: p.hitstop,
          push: 3,
          launch: 0,
          knockdown: false,
          meter: 5,
          group: p.group,
        },
      };
      applyHit(s, s.fighters[p.owner], d, fake, p.dmg, p.group);
      p.alive = false;
      spawnParticles(s, p.x, p.y, 1, 8, 0x7df9ff);
      break;
    }
  }
  if (s.projectiles.length > 24) {
    s.projectiles = s.projectiles.filter((p) => p.alive);
  }
}

function pushApart(s: SimState) {
  for (let ir = 0; ir < 6; ir++) {
    const a = s.fighters[ir];
    if (!a.onScreen || a.ko) continue;
    for (let ib = ir + 1; ib < 6; ib++) {
      const b = s.fighters[ib];
      if (!b.onScreen || b.ko || b.team === a.team) continue;
      const dx = b.x - a.x;
      const dist = Math.abs(dx);
      const min = 46;
      if (dist < min && dist > 0.001) {
        const push = (min - dist) / 2;
        const dir = dx > 0 ? 1 : -1;
        a.x -= dir * push;
        b.x += dir * push;
      } else if (dist <= 0.001) {
        a.x -= 1;
        b.x += 1;
      }
    }
  }
}

// ------------------------------------------------------------ particles
function particlesPass(s: SimState) {
  for (const p of s.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy -= 0.35;
    p.vx *= 0.96;
    p.life--;
    if (p.life <= 0) p.alive = false;
  }
  if (s.particles.length > 40) {
    s.particles = s.particles.filter((p) => p.alive);
  }
}

// ------------------------------------------------------------ CPU / dummy
export function cpuInput(s: SimState, team: number, difficulty: number): number {
  const f = activeFighter(s, team);
  const opp = activeFighter(s, 1 - team);
  if (!f.onScreen || f.ko || f.hitstun > 0) return 0;
  const dx = opp.x - f.x;
  const dist = Math.abs(dx);
  const toward = dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
  const away = dx > 0 ? INPUT.LEFT : INPUT.RIGHT;
  const r = rnd(s);
  const react = 0.55 + difficulty * 0.12;

  if (opp.st === FS.ATTACK && dist < 120 && r < 0.32 + difficulty * 0.1) {
    return away; // block
  }
  if (dist > 300) {
    if (r < 0.1 && ROSTER[f.char].proj) {
      return r < 0.05 ? INPUT.DOWN | toward | INPUT.LP : INPUT.RIGHT | INPUT.LP;
    }
    return toward;
  }
  if (dist > 120) {
    if (r < react * 0.35) return toward | INPUT.LP;
    if (r < 0.12) return INPUT.UP | toward;
    return toward;
  }
  // close range
  if (r < 0.12) return away;
  if (r < 0.34) return INPUT.DOWN | INPUT.LK;
  if (r < 0.5) return INPUT.LP;
  if (r < 0.68) return INPUT.HP;
  if (r < 0.78) return INPUT.HK;
  if (r < 0.86 && f.meter >= BAR) return INPUT.DOWN | toward | INPUT.LP | INPUT.HP;
  if (r < 0.93) return INPUT.DOWN | toward | INPUT.HP;
  return toward;
}

function dummyInput(s: SimState, team: number, mode: number): number {
  const f = activeFighter(s, team);
  const opp = activeFighter(s, 1 - team);
  const dx = opp.x - f.x;
  const toward = dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
  if (mode === 0) return 0;
  if (mode === 1) return dx > 0 ? INPUT.LEFT : INPUT.RIGHT; // always block
  if (mode === 2) return s.frame % 40 === 0 ? INPUT.UP : 0; // jump loop
  if (mode === 3) {
    if (Math.abs(dx) > 110) return toward;
    return s.frame % 8 < 4 ? INPUT.LP : 0;
  }
  return 0;
}

// ------------------------------------------------------------ main step
export function stepGame(s: SimState, cfg: MatchConfig, in0: number, in1: number) {
  if (s.paused) return;
  s.frame++;

  if (s.hitstop > 0) {
    s.hitstop--;
    particlesPass(s);
    if (s.shake > 0) s.shake = Math.max(0, s.shake - 1);
    if (s.hitsparkLife > 0) s.hitsparkLife--;
    return;
  }

  if (s.announceLife > 0) s.announceLife--;
  if (s.shake > 0) s.shake = Math.max(0, s.shake - 1.4);
  if (s.hitsparkLife > 0) s.hitsparkLife--;

  if (s.intro > 0) {
    s.intro--;
    if (s.intro === 0) s.announce = 0;
  }

  // ---- incoming fighter swap ----
  for (let t = 0; t < 2; t++) {
    if (s.incoming[t] >= 0) {
      s.incomingTimer--;
      if (s.incomingTimer <= 0) {
        const slot = s.incoming[t];
        const prev = s.fighters[t * 3 + s.active[t]];
        prev.active = false;
        prev.onScreen = false;
        const nf = s.fighters[t * 3 + slot];
        nf.active = true;
        nf.onScreen = true;
        nf.st = FS.INTRO;
        nf.stFrame = 0;
        nf.hitstun = 0;
        nf.blockstun = 0;
        nf.comboCount = 0;
        nf.x = t === 0 ? 380 : 1220;
        nf.y = 0;
        nf.vy = 0;
        nf.vx = 0;
        nf.airborne = false;
        nf.move = -1;
        nf.invuln = 40;
        s.active[t] = slot;
        s.incoming[t] = -1;
        spawnParticles(s, nf.x, nf.y + 50, 2, 12, 0x7df9ff);
      }
    }
  }

  if (s.over) {
    particlesPass(s);
    return;
  }

  // ---- inputs ----
  const p2auto = cfg.training
    ? dummyInput(s, 1, cfg.dummy)
    : cpuInput(s, 1, cfg.difficulty);

  for (let t = 0; t < 2; t++) {
    const inp = t === 0 ? in0 : cfg.training || cfg.cpu ? p2auto : in1;
    for (let slot = 0; slot < 3; slot++) {
      const f = s.fighters[t * 3 + slot];
      if (!f.active) {
        if (f.onScreen && f.st === FS.ASSIST) {
          // assist lifecycle handled below
        }
        continue;
      }
      if (f.ko) continue;
      processInput(s, f, inp, movesFor(f.char));
    }
  }

  // ---- assists ----
  for (let t = 0; t < 2; t++) {
    if (s.assistCall[t] < 0) continue;
    const slot = s.assistCall[t];
    const a = s.fighters[t * 3 + slot];
    if (!a.onScreen || a.ko) {
      s.assistCall[t] = -1;
      continue;
    }
    a.stFrame++;
    if (a.move < 0 && a.stFrame === 4) {
      // The assist type chosen in team select decides which move the partner
      // brings: 0 = projectile/α, 1 = anti-air/β.
      const variant = cfg.assists[t]?.[slot] ?? 0;
      startMove(s, a, variant === 1 ? M.SP2 : M.ASSIST, movesFor(a.char));
      const partner = s.fighters[t * 3 + s.active[t]];
      a.facing = partner.x >= a.x ? 1 : -1;
    }
    if (a.st === FS.ATTACK) {
      const list = movesFor(a.char);
      const mv = list[a.move];
      if (mv) {
        a.moveFrame++;
        if (a.moveFrame >= mv.startup && a.moveFrame < mv.startup + mv.active && a.moveHits < mv.hits) {
          const hb = hitbox(a, mv);
          for (let os = 0; os < 3; os++) {
            const d = s.fighters[(1 - t) * 3 + os];
            if (!d.onScreen || d.ko || d.invuln > 0) continue;
            if (!overlap(hb, hurtbox(d))) continue;
            applyHit(s, a, d, mv, null, mv.hit.group);
            break;
          }
        }
        if (a.moveFrame >= mv.startup + mv.active + mv.recovery) {
          a.move = -1;
          a.st = FS.ASSIST;
          a.stFrame = 0;
        }
      }
    } else if (a.stFrame > 70) {
      a.onScreen = false;
      a.st = FS.INTRO;
      a.stFrame = 0;
      a.y = 0;
      a.airborne = false;
      s.assistCall[t] = -1;
    }
  }

  // ---- movement + physics ----
  for (let i = 0; i < 6; i++) {
    const f = s.fighters[i];
    if (!f.onScreen) continue;
    if (f.st === FS.ATTACK) {
      tickMoveBody(s, f, movesFor(f.char));
    } else if (f.st === FS.IDLE || f.st === FS.WALK_F || f.st === FS.WALK_B || f.st === FS.CROUCH) {
      f.stFrame++;
    }
    // friction for non-walking states
    if (f.st !== FS.WALK_F && f.st !== FS.WALK_B && f.st !== FS.ATTACK) {
      f.vx *= 0.82;
      if (Math.abs(f.vx) < 0.05) f.vx = 0;
    }
    physics(f);
  }

  // ---- auto facing ----
  for (let t = 0; t < 2; t++) {
    const a = activeFighter(s, t);
    if (!a.onScreen || a.ko) continue;
    if (a.st === FS.IDLE || a.st === FS.WALK_F || a.st === FS.WALK_B || a.st === FS.CROUCH) {
      const o = activeFighter(s, 1 - t);
      a.facing = o.x >= a.x ? 1 : -1;
    }
  }

  pushApart(s);
  combatPass(s);
  projectilePass(s);
  particlesPass(s);

  // ---- combo bookkeeping ----
  for (let i = 0; i < 6; i++) {
    const f = s.fighters[i];
    if (f.hitstun <= 0 && !f.airborne && f.comboCount > 0 && f.hitstop === 0) {
      if (s.hitstop === 0) {
        f.comboCount = 0;
        f.comboDmg = 0;
      }
    }
  }

  // ---- timer ----
  if (!cfg.training && s.intro === 0) {
    s.timer--;
    if (s.timer <= 0) {
      s.timer = 0;
      const a0 = teamHealth(s, 0);
      const a1 = teamHealth(s, 1);
      s.over = true;
      s.winner = a0 === a1 ? -1 : a0 > a1 ? 0 : 1;
      s.announce = 3;
      s.announceLife = 200;
    }
  }

  if (cfg.training) {
    const p = s.fighters[0];
    if (p.meter < MAX_METER) p.meter = MAX_METER;
  }
}

export function teamHealth(s: SimState, team: number): number {
  let total = 0;
  for (let slot = 0; slot < 3; slot++) {
    const f = s.fighters[team * 3 + slot];
    total += f.hp;
  }
  return total;
}

export function resetTraining(s: SimState, cfg: MatchConfig) {
  for (let i = 0; i < 6; i++) {
    const f = s.fighters[i];
    const def = ROSTER[f.char];
    f.hp = def.hp;
    f.hitstun = 0;
    f.blockstun = 0;
    f.hitstop = 0;
    f.comboCount = 0;
    f.comboDmg = 0;
    f.airHits = 0;
    f.invuln = 0;
    f.st = FS.IDLE;
    f.stFrame = 0;
    f.move = -1;
    f.y = 0;
    f.vy = 0;
    f.vx = 0;
    f.airborne = false;
    f.ko = false;
    f.assistCd = 0;
    f.tagLock = 0;
    f.x = f.team === 0 ? 520 : 1080;
    f.facing = f.team === 0 ? 1 : -1;
  }
  s.projectiles = [];
  s.particles = [];
  s.over = false;
  s.winner = -1;
  s.hitstop = 0;
  s.comboHits = 0;
  s.comboTeam = -1;
  s.intro = 0;
  s.timer = cfg.timer;
}

// ------------------------------------------------------------ snapshots
// Explicit deep copy: much faster than structuredClone and guarantees the
// snapshot holds only primitives, so resimulation is exact.
const F_KEYS: (keyof Fighter)[] = [
  "char", "team", "slot", "hp", "maxHp", "meter", "x", "y", "vx", "vy", "facing",
  "st", "stFrame", "hitstun", "blockstun", "hitstop", "move", "moveFrame",
  "moveHits", "nextHit", "hitGroups", "invuln", "airborne", "crouch", "blocking",
  "ko", "comboCount", "comboDmg", "active", "onScreen", "assistCd", "hasHit",
  "airHits", "tagLock", "flash", "qcf", "qcb", "dp", "fwd", "dwn", "chB", "chD",
  "chBF", "chDU", "sj", "prev", "pushed",
];

export function cloneState(s: SimState): SimState {
  const fighters: Fighter[] = [];
  for (let i = 0; i < s.fighters.length; i++) {
    const src = s.fighters[i];
    const dst: Record<string, unknown> = {};
    for (let k = 0; k < F_KEYS.length; k++) {
      const key = F_KEYS[k];
      dst[key as string] = src[key];
    }
    fighters.push(dst as unknown as Fighter);
  }
  const projectiles: Projectile[] = s.projectiles.map((p) => ({ ...p }));
  const particles: Particle[] = s.particles.map((p) => ({ ...p }));
  return {
    frame: s.frame,
    timer: s.timer,
    fighters,
    projectiles,
    particles,
    active: [s.active[0], s.active[1]],
    incoming: [s.incoming[0], s.incoming[1]],
    incomingTimer: s.incomingTimer,
    intro: s.intro,
    over: s.over,
    winner: s.winner,
    hitstop: s.hitstop,
    shake: s.shake,
    hitsparkX: s.hitsparkX,
    hitsparkY: s.hitsparkY,
    hitsparkLife: s.hitsparkLife,
    comboTeam: s.comboTeam,
    comboHits: s.comboHits,
    announce: s.announce,
    announceLife: s.announceLife,
    assistCall: [s.assistCall[0], s.assistCall[1]],
    paused: s.paused,
    rng: s.rng,
    lastComboDmg: s.lastComboDmg,
  } as SimState;
}

export function stateHash(s: SimState): number {
  // FNV-1a over the numeric state, used for desync detection.
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    const n = Math.round(v) | 0;
    h ^= n & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (n >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  for (const f of s.fighters) {
    for (let k = 0; k < F_KEYS.length; k++) {
      const v = f[F_KEYS[k]];
      if (typeof v === "number") mix(v);
      else mix(v ? 1 : 0);
    }
  }
  mix(s.timer);
  mix(s.active[0]);
  mix(s.active[1]);
  mix(s.hitstop);
  return h >>> 0;
}

export { initRng };
