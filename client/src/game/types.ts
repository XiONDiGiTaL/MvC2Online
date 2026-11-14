// Shared types for the deterministic simulation.
// SimState must contain only numbers, booleans and arrays of those, so a
// snapshot is an exact numeric deep copy and rollback resimulation is bit-stable.

export const SCALE = 16;
export const STAGE_W = 1600;
export const WALL_LEFT = 26;
export const WALL_RIGHT = 1574;
export const GRAVITY = 1; // px/frame^2 (speed values below are tuned against this)
export const MAX_METER = 500;
export const BAR = 100;
export const ROUND_FRAMES = 99 * 60;
export const THROW_RANGE = 62;

export const INPUT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  LP: 16,
  HP: 32,
  LK: 64,
  HK: 128,
  A1: 256,
  A2: 512,
} as const;

export const BUTTONS =
  INPUT.LP | INPUT.HP | INPUT.LK | INPUT.HK | INPUT.A1 | INPUT.A2;

/** Fighter state machine values (plain consts: esbuild cannot inline enums across files). */
export const FS = {
  INTRO: 0,
  IDLE: 1,
  WALK_F: 2,
  WALK_B: 3,
  CROUCH: 4,
  JUMP: 5,
  LAND: 6,
  ATTACK: 7,
  HITSTUN: 8,
  BLOCKSTUN: 9,
  KNOCKDOWN: 10,
  WAKEUP: 11,
  ASSIST: 12,
  KO: 13,
  WON: 14,
} as const;

export type Archetype = "balanced" | "rushdown" | "grappler" | "zoner" | "technical";

export interface CharacterDef {
  id: string;
  name: string;
  short: string;
  side: "marvel" | "capcom";
  arch: Archetype;
  hp: number;
  walkF: number;
  walkB: number;
  jump: number;
  weight: number;
  hue: number;
  skin: number;
  proj: boolean;
  /** [special 1, special 2, hyper] display names */
  sp: [string, string, string];
  tagline: string;
}

export interface HitDef {
  dmg: number;
  hitstun: number;
  blockstun: number;
  /** 0 mid, 1 low, 2 overhead */
  level: number;
  hitstop: number;
  push: number;
  launch: number;
  knockdown: boolean;
  meter: number;
  group: number;
}

export interface MoveDef {
  id: string;
  name: string;
  startup: number;
  active: number;
  recovery: number;
  hx: number;
  hy: number;
  hw: number;
  hh: number;
  vx: number;
  vy: number;
  air: boolean;
  low: boolean;
  overhead: boolean;
  hits: number;
  interval: number;
  hit: HitDef;
  proj: { speed: number; life: number; w: number; h: number; dmg: number; delay: number } | null;
  invuln: number;
  cost: number;
  hyper: boolean;
  /** cancels into these move ids once it connects */
  cancels: string[];
}

export interface Fighter {
  char: number;
  team: number;
  slot: number;
  hp: number;
  maxHp: number;
  meter: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  st: number;
  stFrame: number;
  hitstun: number;
  blockstun: number;
  hitstop: number;
  move: number;
  moveFrame: number;
  moveHits: number;
  nextHit: number;
  hitGroups: number;
  invuln: number;
  airborne: boolean;
  crouch: boolean;
  blocking: boolean;
  ko: boolean;
  comboCount: number;
  comboDmg: number;
  active: boolean;
  onScreen: boolean;
  assistCd: number;
  hasHit: boolean;
  airHits: number;
  tagLock: number;
  flash: number;
  /** motion buffers (rollback-safe, no frame history needed) */
  qcf: number;
  qcb: number;
  dp: number;
  fwd: number;
  dwn: number;
  chB: number;
  chD: number;
  chBF: number;
  chDU: number;
  sj: number;
  prev: number;
  /** guard-cancel flash */
  pushed: number;
}

export interface Projectile {
  alive: boolean;
  owner: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  w: number;
  h: number;
  life: number;
  dmg: number;
  hitstop: number;
  hitstun: number;
  blockstun: number;
  group: number;
}

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  kind: number;
  size: number;
  color: number;
}

export interface SimState {
  frame: number;
  timer: number;
  fighters: Fighter[];
  projectiles: Projectile[];
  particles: Particle[];
  active: number[];
  incoming: number[];
  incomingTimer: number;
  intro: number;
  over: boolean;
  winner: number;
  hitstop: number;
  shake: number;
  hitsparkX: number;
  hitsparkY: number;
  hitsparkLife: number;
  comboTeam: number;
  comboHits: number;
  announce: number; // 0 none, 1 fight, 2 ko, 3 win, 4 hyper
  announceLife: number;
  assistCall: number[];
  paused: boolean;
  rng: number;
  lastComboDmg: number;
}

export interface MatchConfig {
  teams: number[][];
  assists: number[][];
  colors: number[][];
  stage: number;
  timer: number;
  training: boolean;
  dummy: number;
  difficulty: number;
  seed: number;
  /** second player is driven by the CPU (arcade / training) */
  cpu: boolean;
}
