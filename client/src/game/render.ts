// Canvas renderer. Fighters are drawn procedurally from the roster hue seed;
// portraits use the supplied sheet when it has been sliced into
// public/portraits, and fall back to the drawn bust otherwise.
// Rendering may use trigonometry; the simulation may not.

import { ROSTER, colorsFor, hex } from "./roster";
import { SHEET_PORTRAITS } from "./portrait-manifest";
import { FS, ROUND_FRAMES, type Fighter, type MatchConfig, type SimState } from "./types";

export const VIEW_W = 1280;
export const VIEW_H = 720;
const FLOOR = 596;

interface Cam {
  x: number;
  zoom: number;
}

function camera(s: SimState): Cam {
  const a = s.fighters[s.active[0]];
  const b = s.fighters[3 + s.active[1]];
  const mid = (a.x + b.x) / 2;
  const dist = Math.abs(a.x - b.x);
  const zoom = Math.max(0.82, Math.min(1.12, 1500 / (dist + 900)));
  const halfView = VIEW_W / 2 / zoom;
  const x = Math.max(halfView, Math.min(1600 - halfView, mid));
  return { x, zoom };
}

// World space is authored directly in canvas coordinates: the ground line is at
// y = FLOOR and a fighter standing at y = 0 sits on it. So the camera has to
// zoom about that same floor line — translating by FLOOR again would push every
// fighter a full screen below the stage.
function withCam(ctx: CanvasRenderingContext2D, cam: Cam, fn: () => void) {
  ctx.save();
  ctx.translate(VIEW_W / 2, FLOOR);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -FLOOR);
  fn();
  ctx.restore();
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

// ------------------------------------------------------------------ stage
const STAGE_NAMES = [
  "NEO TOKYO ROOFTOP",
  "HARBOR DISTRICT",
  "DEEP SPACE STATION",
  "TRAINING GRID",
  "ABANDONED CLOCKTOWER",
  "MUTANT LAB",
];

export function stageName(i: number): string {
  return STAGE_NAMES[i % STAGE_NAMES.length];
}

function drawStage(ctx: CanvasRenderingContext2D, cam: Cam, stage: number, frame: number) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  const hues = [
    ["#05070a", "#0a1220", "#12233c"],
    ["#05080c", "#0a1424", "#102a44"],
    ["#04060a", "#080f1c", "#0e1d33"],
    ["#050709", "#0a1119", "#101f2e"],
    ["#06070a", "#0b1020", "#131c33"],
    ["#04060b", "#090f1f", "#0f1a33"],
  ][stage % 6];
  g.addColorStop(0, hues[0]);
  g.addColorStop(0.55, hues[1]);
  g.addColorStop(1, hues[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // far skyline (parallax)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#05050c";
  const off = cam.x * 0.12;
  for (let i = -2; i < 24; i++) {
    const bx = i * 110 - off;
    const bh = 90 + ((i * 7919) % 11) * 26;
    ctx.fillRect(bx, FLOOR - bh, 74, bh);
    ctx.fillStyle = "rgba(120,180,255,0.10)";
    for (let wy = 0; wy < 6; wy++) {
      for (let wx = 0; wx < 3; wx++) {
        if (((i * 13 + wy * 5 + wx * 3) % 7) === 0) {
          ctx.fillRect(bx + 10 + wx * 20, FLOOR - bh + 16 + wy * 22, 9, 10);
        }
      }
    }
    ctx.fillStyle = "#05050c";
  }
  ctx.restore();

  // mid layer crowd / rail
  ctx.save();
  ctx.globalAlpha = 0.45;
  const off2 = cam.x * 0.28;
  ctx.fillStyle = "#080810";
  for (let i = -2; i < 34; i++) {
    const cx = i * 62 - off2;
    const h = 46 + ((i * 104729) % 9) * 5;
    ctx.beginPath();
    ctx.arc(cx, FLOOR - h, 15, 0, Math.PI * 2);
    ctx.fill();
    rr(ctx, cx - 17, FLOOR - h + 10, 34, h, 10);
    ctx.fill();
  }
  ctx.restore();

  // floor
  const fg = ctx.createLinearGradient(0, FLOOR - 10, 0, VIEW_H);
  fg.addColorStop(0, "rgba(255,255,255,0.13)");
  fg.addColorStop(0.15, "rgba(0,0,0,0.55)");
  fg.addColorStop(1, "#05050a");
  ctx.fillStyle = fg;
  ctx.fillRect(0, FLOOR - 8, VIEW_W, VIEW_H - FLOOR + 8);

  // floor grid lines with perspective
  ctx.save();
  ctx.strokeStyle = "rgba(140,190,255,0.10)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const y = FLOOR + i * i * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
    ctx.stroke();
  }
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 + i * 40, FLOOR);
    ctx.lineTo(VIEW_W / 2 + i * 130, VIEW_H);
    ctx.stroke();
  }
  ctx.restore();

  // ambient light pool
  const lg = ctx.createRadialGradient(VIEW_W / 2, FLOOR - 40, 40, VIEW_W / 2, FLOOR - 40, 620);
  lg.addColorStop(0, "rgba(63,128,255,0.13)");
  lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // sweep light
  const sweep = ((frame * 0.6) % (VIEW_W + 400)) - 200;
  const sg = ctx.createLinearGradient(sweep - 120, 0, sweep + 120, VIEW_H);
  sg.addColorStop(0, "rgba(120,200,255,0)");
  sg.addColorStop(0.5, "rgba(120,200,255,0.045)");
  sg.addColorStop(1, "rgba(120,200,255,0)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ---------------------------------------------------------------- fighter
// Fighters are painted into a small one-unit-per-pixel surface and then blitted
// at 2x with smoothing disabled, so every shape lands on a chunky arcade pixel
// grid. The body is built from joints, which is what lets one figure read as
// idle, walking, crouching, attacking, stunned or knocked out without any
// per-character artwork.
const SPR_W = 132;
const SPR_H = 124;
const SPR_FEET_X = 66;
const SPR_FEET_Y = 112;
const OUTLINE = "#05060b";

const HALO: [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

const surfaces: { [k in "fig" | "sil" | "spr"]?: CanvasRenderingContext2D } = {};

/** One reused 132x124 surface per role, cleared and returned ready to draw. */
function surface(role: "fig" | "sil" | "spr"): CanvasRenderingContext2D {
  let g = surfaces[role];
  if (!g) {
    const c = document.createElement("canvas");
    c.width = SPR_W;
    c.height = SPR_H;
    const built = c.getContext("2d");
    if (!built) throw new Error("2d context unavailable");
    built.imageSmoothingEnabled = false;
    g = built;
    surfaces[role] = g;
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.clearRect(0, 0, SPR_W, SPR_H);
  return g;
}

interface Look {
  head: "bare" | "mask" | "hair" | "bandana" | "helmet";
  hair: number;
  bulk: number;
  size: number;
  cape?: boolean;
  scarf?: boolean;
  claws?: boolean;
}

// Per-character silhouette cues. Everything not listed falls back to a build
// derived from the roster weight and a head style derived from the archetype.
const LOOKS: Record<string, Partial<Look>> = {
  hulk: { head: "bare", bulk: 1.34, size: 1.1 },
  juggernaut: { head: "helmet", bulk: 1.32, size: 1.09 },
  colossus: { head: "bare", bulk: 1.28, size: 1.05 },
  sentinel: { head: "helmet", bulk: 1.22, size: 1.14 },
  zangief: { head: "bare", bulk: 1.28, size: 1.05 },
  thanos: { head: "helmet", bulk: 1.22, size: 1.06 },
  "omega-red": { head: "helmet", bulk: 1.2 },
  amingo: { head: "bare", bulk: 1.2 },
  venom: { head: "mask", bulk: 1.22 },
  sabretooth: { head: "hair", hair: 0xd8b070, bulk: 1.18 },
  jin: { head: "helmet", bulk: 1.22, size: 1.06 },
  spiderman: { head: "mask" },
  ironman: { head: "helmet" },
  warmachine: { head: "helmet", bulk: 1.12 },
  magneto: { head: "helmet", cape: true },
  doom: { head: "helmet", cape: true },
  storm: { head: "hair", hair: 0xe8ecf4, cape: true },
  wolverine: { head: "mask", claws: true },
  "wolverine-bone": { head: "mask", claws: true },
  cap: { head: "helmet" },
  cyclops: { head: "helmet" },
  ryu: { head: "bandana" },
  ken: { head: "hair", hair: 0xe8c060 },
  akuma: { head: "bandana", hair: 0xb03020 },
  dan: { head: "bandana" },
  guile: { head: "hair", hair: 0xe8d070, bulk: 1.1 },
  chunli: { head: "hair", hair: 0x2a1c14 },
  cammy: { head: "hair", hair: 0xf0d060 },
  bison: { head: "helmet", bulk: 1.12 },
  dhalsim: { head: "bare", hair: 0x2a1c14 },
  strider: { head: "mask", scarf: true },
  morrigan: { head: "hair", hair: 0x1a3a2a, cape: true },
  felicia: { head: "hair", hair: 0x8fd0e0 },
  servbot: { head: "helmet", size: 0.82 },
  roll: { head: "helmet", size: 0.9 },
  megaman: { head: "helmet", size: 0.92 },
  shuma: { head: "bare", bulk: 1.08 },
  bbhood: { head: "hair", hair: 0xd8a050, size: 0.92 },
  psylocke: { head: "hair", hair: 0x3a2a5a },
  rogue: { head: "hair", hair: 0x8a4a2a },
  marrow: { head: "hair", hair: 0x5a4a3a },
  sonson: { head: "hair", hair: 0x3a2418 },
  tron: { head: "helmet", size: 0.94 },
  blackheart: { head: "helmet", bulk: 1.1 },
  "silver-samurai": { head: "helmet", bulk: 1.06 },
  jill: { head: "hair", hair: 0x2a2418 },
  hayato: { head: "helmet" },
  cable: { head: "hair", hair: 0x9aa4b0, bulk: 1.1 },
  gambit: { head: "hair", hair: 0x4a3020 },
  iceman: { head: "bare" },
  ruby: { head: "hair", hair: 0x2a2438, cape: true },
  spiral: { head: "hair", hair: 0x2a4a8a },
};

const ARCH_HEAD: Record<string, Look["head"]> = {
  grappler: "bare",
  rushdown: "hair",
  zoner: "helmet",
  technical: "mask",
  balanced: "bandana",
};

function lookForChar(char: number): Look {
  const def = ROSTER[char] ?? ROSTER[0];
  const preset = LOOKS[def.id] ?? {};
  return {
    head: preset.head ?? ARCH_HEAD[def.arch] ?? "hair",
    hair: preset.hair ?? 0x241a14,
    bulk: preset.bulk ?? Math.max(0.9, Math.min(1.22, 0.86 + (def.weight - 1) * 0.5)),
    size: preset.size ?? Math.max(0.86, Math.min(1.12, 0.92 + (def.weight - 1) * 0.24)),
    cape: preset.cape,
    scarf: preset.scarf,
    claws: preset.claws,
  };
}

function lookFor(f: Fighter): Look {
  return lookForChar(f.char);
}

function mix(a: number, b: number, t: number): string {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return `rgb(${Math.round(ar + (br - ar) * t)},${Math.round(ag + (bg - ag) * t)},${Math.round(ab + (bb - ab) * t)})`;
}

interface Palette {
  suit: string;
  suitDark: string;
  suitLight: string;
  trim: string;
  trimDark: string;
  skin: string;
  skinDark: string;
}

function paletteForChar(char: number, colorIdx: number): Palette {
  const c = colorsFor(char, colorIdx);
  return {
    suit: hex(c.primary),
    suitDark: mix(c.primary, 0x05060a, 0.46),
    suitLight: mix(c.primary, 0xffffff, 0.3),
    trim: hex(c.accent),
    trimDark: mix(c.accent, 0x05060a, 0.42),
    skin: hex(c.skin),
    skinDark: mix(c.skin, 0x1a1208, 0.3),
  };
}

function paletteFor(f: Fighter, colorIdx: number): Palette {
  return paletteForChar(f.char, colorIdx);
}

type Point = [number, number];

interface Pose {
  hipY: number;
  shoulderY: number;
  headY: number;
  armF: Point[];
  armB: Point[];
  legF: Point[];
  legB: Point[];
}

function isKickMove(move: number): boolean {
  return (move >= 2 && move <= 3) || move === 5 || move === 7 || move >= 10;
}

function poseFor(f: Fighter, simFrame: number): Pose {
  const t = f.stFrame || simFrame;
  const breathe = Math.sin(simFrame * 0.09) * 1.1;

  const p: Pose = {
    hipY: 46,
    shoulderY: 74 + breathe,
    headY: 88 + breathe,
    armF: [[12, 74 + breathe], [18, 64 + breathe], [20, 55 + breathe]],
    armB: [[-12, 74 + breathe], [-17, 63 + breathe], [-14, 53 + breathe]],
    legF: [[4, 46], [7, 28], [9, 4]],
    legB: [[-4, 46], [-7, 28], [-9, 4]],
  };

  if (f.st === FS.CROUCH || (f.crouch && f.st !== FS.JUMP && f.st !== FS.HITSTUN)) {
    p.hipY = 30;
    p.shoulderY = 56;
    p.headY = 69;
    p.legF = [[5, 32], [14, 18], [11, 4]];
    p.legB = [[-5, 32], [-13, 18], [-11, 4]];
    p.armF = [[11, 56], [17, 48], [15, 40]];
    p.armB = [[-11, 56], [-16, 47], [-14, 39]];
  } else if (f.st === FS.JUMP || f.airborne) {
    p.hipY = 48;
    p.legF = [[4, 48], [13, 38], [9, 26]];
    p.legB = [[-4, 48], [-11, 36], [-13, 24]];
    p.armF = [[11, 76], [17, 84], [19, 92]];
    p.armB = [[-11, 76], [-16, 82], [-18, 90]];
  } else if (f.st === FS.LAND) {
    p.hipY = 38;
    p.shoulderY = 68;
    p.headY = 81;
    p.legF = [[5, 38], [12, 22], [10, 4]];
    p.legB = [[-5, 38], [-11, 22], [-11, 4]];
  } else if (f.st === FS.WALK_F || f.st === FS.WALK_B) {
    const dir = f.st === FS.WALK_F ? 1 : -1;
    const s = Math.sin(t * 0.34) * dir;
    p.legF = [[4, 46], [7 + s * 7, 28], [9 + s * 11, 4 + Math.max(0, s) * 3]];
    p.legB = [[-4, 46], [-7 - s * 7, 28], [-9 - s * 11, 4 - Math.min(0, s) * 3]];
    p.armF = [[12, 74], [18 - s * 4, 64], [20 - s * 5, 55]];
    p.armB = [[-12, 74], [-17 + s * 4, 63], [-14 + s * 5, 53]];
  } else if (f.st === FS.HITSTUN) {
    p.shoulderY = 73;
    p.headY = 86;
    p.armF = [[8, 72], [0, 66], [3, 58]];
    p.armB = [[-10, 72], [-18, 64], [-19, 54]];
    p.legF = [[4, 46], [10, 28], [10, 4]];
    p.legB = [[-4, 46], [-12, 28], [-15, 6]];
  } else if (f.st === FS.BLOCKSTUN) {
    p.hipY = 40;
    p.shoulderY = 68;
    p.headY = 82;
    p.legF = [[4, 40], [9, 24], [8, 4]];
    p.legB = [[-4, 40], [-9, 24], [-11, 4]];
    p.armF = [[12, 68], [19, 66], [18, 58]];
    p.armB = [[5, 68], [14, 62], [13, 54]];
  } else if (f.st === FS.WON) {
    p.armF = [[10, 76], [15, 90], [13, 100]];
    p.armB = [[-10, 76], [-15, 90], [-13, 100]];
  } else if (f.st === FS.INTRO) {
    p.armF = [[12, 74], [19, 66], [23, 62]];
    p.armB = [[-12, 74], [-17, 62], [-18, 52]];
  }

  if (f.st === FS.ATTACK) {
    const ph = attackPunchPhase(f);
    if (isKickMove(f.move)) {
      p.hipY = 46 - ph * 2;
      p.legF = [[4, 46], [9 + ph * 14, 34], [11 + ph * 30, 32 - ph * 10]];
      p.legB = [[-4, 46], [-8, 28], [-10, 4]];
    } else {
      p.armF = [[12, 75], [19 + ph * 10, 72], [23 + ph * 20, 70]];
      p.armB = [[-12, 74], [-17, 62], [-14, 52]];
    }
  }

  return p;
}

function bone(
  g: CanvasRenderingContext2D,
  a: Point,
  m: Point,
  e: Point,
  w: number,
  color: string
) {
  const seg = (p: Point, q: Point, width: number) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(p[0] + nx, p[1] + ny);
    g.lineTo(q[0] + nx, q[1] + ny);
    g.lineTo(q[0] - nx, q[1] - ny);
    g.lineTo(p[0] - nx, p[1] - ny);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(p[0], p[1], width / 2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(q[0], q[1], width / 2, 0, Math.PI * 2);
    g.fill();
  };
  seg(a, m, w);
  seg(m, e, w * 0.88);
}

function drawHead(
  g: CanvasRenderingContext2D,
  look: Look,
  pal: Palette,
  hy: number,
  c: (v: string) => string
) {
  // NOTE: the sprite space is y-up, so a rect's y argument is its LOWER edge
  // and it grows upward. Every rect below is anchored that way.
  const hair = hex(look.hair);
  const dark = c("#141821");

  // neck: hy-14 .. hy-8
  g.fillStyle = c(pal.skinDark);
  g.fillRect(-3, hy - 14, 6, 6);

  if (look.head === "hair") {
    g.fillStyle = c(hair);
    g.beginPath();
    g.arc(0, hy + 1.5, 9.6, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-11, hy - 6, 5, 9);
  }

  // skull + chin
  g.fillStyle = c(pal.skin);
  g.beginPath();
  g.arc(1, hy, 8.6, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-3, hy - 11, 10, 7);

  switch (look.head) {
    case "mask": {
      g.fillStyle = c(pal.suit);
      g.beginPath();
      g.arc(1, hy, 8.8, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-3, hy - 12, 11, 8);
      g.fillStyle = c("#eaf1ff");
      g.beginPath();
      g.ellipse(4.6, hy + 1, 3.4, 2.1, -0.3, 0, Math.PI * 2);
      g.ellipse(-0.6, hy + 1, 2.4, 1.8, 0.3, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "helmet": {
      g.fillStyle = c(pal.trimDark);
      g.beginPath();
      g.arc(1, hy + 1, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c(pal.skin);
      g.beginPath();
      g.arc(2, hy - 2, 6, 0, Math.PI * 2);
      g.fill();
      g.fillRect(0, hy - 10, 7, 5);
      g.fillStyle = c(pal.trimDark);
      g.fillRect(-8, hy + 1, 18, 2.4);
      g.fillStyle = dark;
      g.fillRect(3, hy - 2, 2.4, 2.2);
      g.fillRect(-1, hy - 2, 1.8, 2);
      break;
    }
    case "bandana": {
      g.fillStyle = c(hair);
      g.fillRect(-7, hy + 6, 15, 3);
      g.fillStyle = c(pal.trim);
      g.fillRect(-7, hy + 2, 16, 3.4);
      g.fillRect(-12, hy - 4, 5, 7);
      g.fillStyle = dark;
      g.fillRect(3, hy - 2, 2.6, 2.4);
      g.fillRect(-1.5, hy - 2, 2, 2);
      g.fillRect(1.5, hy - 6, 3.6, 1.4);
      break;
    }
    case "bare": {
      g.fillStyle = c(hair);
      g.fillRect(-6, hy + 6, 14, 3);
      g.fillRect(-6, hy - 1, 3, 7);
      g.fillStyle = dark;
      g.fillRect(3, hy - 2, 2.6, 2.4);
      g.fillRect(-1.5, hy - 2, 2, 2);
      g.fillRect(1.5, hy - 6, 3.6, 1.4);
      break;
    }
    default: {
      g.fillStyle = c(hair);
      g.fillRect(-7, hy + 6, 15, 3);
      g.fillRect(-7, hy, 3, 6);
      g.fillStyle = dark;
      g.fillRect(3, hy - 2, 2.6, 2.4);
      g.fillRect(-1.5, hy - 2, 2, 2);
      g.fillRect(1.5, hy - 6, 3.6, 1.4);
    }
  }

  if (look.scarf) {
    g.fillStyle = c(pal.trim);
    g.beginPath();
    g.moveTo(-5, hy - 6);
    g.lineTo(-10, hy - 14);
    g.lineTo(-18, hy - 20);
    g.lineTo(-9, hy - 11);
    g.closePath();
    g.fill();
  }
}

function paintFigure(
  g: CanvasRenderingContext2D,
  f: Fighter,
  look: Look,
  pal: Palette,
  simFrame: number,
  force: string | null
) {
  const p = poseFor(f, simFrame);
  const c = (v: string) => force ?? v;
  const hip = p.hipY;
  const sh = p.shoulderY;
  const hy = p.headY;

  g.save();
  g.scale(look.bulk, 1);

  if (look.cape) {
    g.fillStyle = c(pal.suitDark);
    g.beginPath();
    g.moveTo(-8, sh + 2);
    g.lineTo(0, sh + 2);
    g.quadraticCurveTo(-13, hip + 6, -20, hip - 18);
    g.quadraticCurveTo(-9, hip - 2, -6, hip + 1);
    g.closePath();
    g.fill();
  }

  // back leg + boot
  bone(g, p.legB[0], p.legB[1], p.legB[2], 9, c(pal.suitDark));
  g.fillStyle = c(pal.trimDark);
  g.fillRect(p.legB[2][0] - 4, p.legB[2][1] - 1, 12, 6);

  // back arm + fist
  bone(g, p.armB[0], p.armB[1], p.armB[2], 7, c(pal.suitDark));
  g.fillStyle = c(pal.trimDark);
  g.beginPath();
  g.arc(p.armB[2][0], p.armB[2][1], 3.4, 0, Math.PI * 2);
  g.fill();

  // front leg + boot
  bone(g, p.legF[0], p.legF[1], p.legF[2], 10, c(pal.suit));
  g.fillStyle = c(pal.trim);
  g.fillRect(p.legF[2][0] - 4, p.legF[2][1], 12, 6);

  // torso: shoulders tapering into the waist with a crotch notch
  g.beginPath();
  g.moveTo(-12, sh + 2);
  g.lineTo(12, sh + 2);
  g.lineTo(9, hip + 2);
  g.lineTo(3, hip - 2);
  g.lineTo(-3, hip - 2);
  g.lineTo(-9, hip + 2);
  g.closePath();
  g.fillStyle = c(pal.suit);
  g.fill();

  if (!force) {
    g.fillStyle = pal.suitDark;
    g.fillRect(-12, hip + 2, 3, sh - hip);
    g.fillStyle = pal.suitLight;
    g.fillRect(9, hip + 2, 3, sh - hip);
  }

  // chest panel + gi lapel
  g.fillStyle = c(pal.suitDark);
  g.fillRect(-6, sh - 15, 12, 11);
  g.fillStyle = c(pal.trim);
  g.beginPath();
  g.moveTo(-7, sh + 1);
  g.lineTo(7, sh + 1);
  g.lineTo(0, sh - 12);
  g.closePath();
  g.fill();

  // belt
  g.fillStyle = c(pal.trim);
  g.fillRect(-9, hip - 1, 18, 4);

  // emblem
  g.fillStyle = c(pal.trim);
  g.beginPath();
  g.arc(1, sh - 11, 2.4, 0, Math.PI * 2);
  g.fill();

  if (look.bulk > 1.12) {
    g.fillStyle = c(pal.trimDark);
    g.beginPath();
    g.arc(-11, sh + 1, 4.6, 0, Math.PI * 2);
    g.arc(11, sh + 1, 4.6, 0, Math.PI * 2);
    g.fill();
  }

  drawHead(g, look, pal, hy, c);

  // front arm + glove
  bone(g, p.armF[0], p.armF[1], p.armF[2], 8, c(pal.suit));
  g.fillStyle = c(pal.trim);
  g.beginPath();
  g.arc(p.armF[2][0], p.armF[2][1], 3.8, 0, Math.PI * 2);
  g.fill();

  if (look.claws && !force) {
    g.strokeStyle = "#e8eef8";
    g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(p.armF[2][0], p.armF[2][1] - 1.6 + i * 2);
      g.lineTo(p.armF[2][0] + 11, p.armF[2][1] - 3 + i * 2);
      g.stroke();
    }
  }

  g.restore();
}

function bodyH(f: Fighter): number {
  return f.crouch ? 78 : 116;
}

// -------------------------------------------------------------- portraits
// The select screen and gallery show the same head the fighter is drawn with,
// so a character's portrait is literally its sprite face rather than a colour
// swatch with initials on it.
const portraitCache = new Map<string, string>();

export function portraitUrl(char: number, colorIdx: number, px = 96): string {
  if (SHEET_PORTRAITS.has(char)) {
    return `${import.meta.env.BASE_URL}portraits/p${String(char).padStart(2, "0")}.png`;
  }
  const key = `${char}:${colorIdx}:${px}`;
  const cached = portraitCache.get(key);
  if (cached) return cached;

  const look = lookForChar(char);
  const pal = paletteForChar(char, colorIdx);
  const out = document.createElement("canvas");
  out.width = px;
  out.height = px;
  const o = out.getContext("2d");
  if (!o) return "";
  // Portraits are vector-drawn at full size rather than upscaled from a
  // 34-pixel sprite grid, which is what made them read as coloured blobs.
  paintBust(o, look, pal, px);
  const url = out.toDataURL("image/png");
  portraitCache.set(key, url);
  return url;
}

/** Cel-shaded head-and-shoulders portrait, drawn to fit a px x px square. */
function paintBust(g: CanvasRenderingContext2D, look: Look, pal: Palette, px: number) {
  const S = px;
  const hair = hex(look.hair);
  const ink = "#080a10";
  const cx = S * 0.5;
  const headR = S * 0.175 * Math.min(1.18, look.bulk);
  const headY = S * 0.46;

  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";

  // --- tile background -----------------------------------------------------
  const bg = g.createLinearGradient(0, 0, S * 0.6, S);
  bg.addColorStop(0, "#17294d");
  bg.addColorStop(0.55, "#0d1628");
  bg.addColorStop(1, "#070a12");
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  g.save();
  g.globalAlpha = 0.07;
  g.fillStyle = "#8fb8ff";
  for (let i = -S; i < S * 2; i += S * 0.16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + S * 0.05, 0);
    g.lineTo(i + S * 0.05 + S * 0.5, S);
    g.lineTo(i + S * 0.5, S);
    g.closePath();
    g.fill();
  }
  g.restore();

  // --- shoulders / torso ---------------------------------------------------
  const shoulderY = headY + headR * 1.55;
  g.fillStyle = pal.suitDark;
  g.beginPath();
  g.moveTo(cx - S * 0.46, S);
  g.quadraticCurveTo(cx - S * 0.40, shoulderY, cx - S * 0.20, shoulderY - S * 0.02);
  g.lineTo(cx + S * 0.20, shoulderY - S * 0.02);
  g.quadraticCurveTo(cx + S * 0.40, shoulderY, cx + S * 0.46, S);
  g.closePath();
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = S * 0.018;
  g.stroke();

  // chest panel + collar trim
  g.fillStyle = pal.suit;
  g.beginPath();
  g.moveTo(cx - S * 0.17, S);
  g.lineTo(cx - S * 0.13, shoulderY + S * 0.03);
  g.lineTo(cx + S * 0.13, shoulderY + S * 0.03);
  g.lineTo(cx + S * 0.17, S);
  g.closePath();
  g.fill();
  g.fillStyle = pal.trim;
  g.beginPath();
  g.moveTo(cx - S * 0.155, shoulderY + S * 0.055);
  g.lineTo(cx + S * 0.155, shoulderY + S * 0.055);
  g.lineTo(cx + S * 0.14, shoulderY + S * 0.095);
  g.lineTo(cx - S * 0.14, shoulderY + S * 0.095);
  g.closePath();
  g.fill();

  // --- hair mass behind the head ------------------------------------------
  if (look.head === "hair" || look.head === "bandana") {
    g.fillStyle = hair;
    g.beginPath();
    g.ellipse(cx, headY - headR * 0.12, headR * 1.16, headR * 1.1, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx - headR * 0.75, headY + headR * 0.55, headR * 0.5, headR * 0.95, 0.35, 0, Math.PI * 2);
    g.ellipse(cx + headR * 0.75, headY + headR * 0.55, headR * 0.5, headR * 0.95, -0.35, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = S * 0.016;
    g.stroke();
  }

  // --- neck ----------------------------------------------------------------
  g.fillStyle = pal.skinDark;
  g.beginPath();
  g.roundRect(cx - headR * 0.34, headY + headR * 0.55, headR * 0.68, headR * 0.95, headR * 0.2);
  g.fill();

  // --- head shape ----------------------------------------------------------
  g.fillStyle = pal.skin;
  g.beginPath();
  g.ellipse(cx, headY, headR * 0.94, headR * 1.06, 0, 0, Math.PI * 2);
  g.fill();
  // jaw taper
  g.beginPath();
  g.moveTo(cx - headR * 0.78, headY + headR * 0.30);
  g.quadraticCurveTo(cx - headR * 0.5, headY + headR * 1.12, cx, headY + headR * 1.14);
  g.quadraticCurveTo(cx + headR * 0.5, headY + headR * 1.12, cx + headR * 0.78, headY + headR * 0.30);
  g.closePath();
  g.fill();
  // ear
  g.beginPath();
  g.ellipse(cx + headR * 0.9, headY + headR * 0.12, headR * 0.14, headR * 0.24, 0, 0, Math.PI * 2);
  g.fill();

  // --- face shading ---------------------------------------------------------
  const shade = g.createLinearGradient(cx - headR, headY, cx + headR, headY);
  shade.addColorStop(0, "rgba(0,0,0,0.28)");
  shade.addColorStop(0.45, "rgba(0,0,0,0)");
  g.save();
  g.beginPath();
  g.ellipse(cx, headY + headR * 0.2, headR * 0.95, headR * 1.05, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = shade;
  g.fillRect(cx - headR * 1.2, headY - headR, headR * 2.4, headR * 2.6);
  g.restore();

  // --- eyes, brows, nose, mouth -------------------------------------------
  const eyeY = headY + headR * 0.10;
  const eyeDx = headR * 0.38;
  const eyeR = headR * 0.235;
  if (look.head === "mask" || look.head === "helmet") {
    // Costume over the whole face: white lenses with a hard rim.
    g.fillStyle = look.head === "mask" ? "#f2f6ff" : "#dfe8ff";
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * eyeDx, eyeY, eyeR * 1.25, eyeR * 0.78, s * 0.22, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = ink;
    g.lineWidth = S * 0.012;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(cx + s * eyeDx, eyeY, eyeR * 1.25, eyeR * 0.78, s * 0.22, 0, Math.PI * 2);
      g.stroke();
    }
  } else {
    for (const s of [-1, 1]) {
      const ex = cx + s * eyeDx;
      g.fillStyle = "#f7f4ee";
      g.beginPath();
      g.ellipse(ex, eyeY, eyeR, eyeR * 0.74, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1b2430";
      g.beginPath();
      g.arc(ex + s * eyeR * 0.16, eyeY + eyeR * 0.05, eyeR * 0.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = S * 0.009;
      g.beginPath();
      g.ellipse(ex, eyeY, eyeR, eyeR * 0.74, 0, 0, Math.PI * 2);
      g.stroke();
      // brow
      g.strokeStyle = hair;
      g.lineWidth = S * 0.02;
      g.beginPath();
      g.moveTo(ex - s * eyeR * 0.9, eyeY - eyeR * 1.5);
      g.lineTo(ex + s * eyeR * 1.0, eyeY - eyeR * 1.9);
      g.stroke();
    }
  }

  // nose + mouth
  g.strokeStyle = "rgba(0,0,0,0.42)";
  g.lineWidth = S * 0.011;
  g.beginPath();
  g.moveTo(cx + headR * 0.06, eyeY + headR * 0.16);
  g.lineTo(cx - headR * 0.04, eyeY + headR * 0.44);
  g.lineTo(cx + headR * 0.12, eyeY + headR * 0.48);
  g.stroke();
  g.strokeStyle = "rgba(20,10,10,0.55)";
  g.lineWidth = S * 0.013;
  g.beginPath();
  g.moveTo(cx - headR * 0.2, headY + headR * 0.78);
  g.quadraticCurveTo(cx, headY + headR * 0.86, cx + headR * 0.2, headY + headR * 0.78);
  g.stroke();

  // --- headgear ------------------------------------------------------------
  if (look.head === "hair") {
    g.fillStyle = hair;
    g.beginPath();
    g.moveTo(cx - headR * 0.95, headY - headR * 0.25);
    g.quadraticCurveTo(cx - headR * 0.2, headY - headR * 1.35, cx + headR * 0.95, headY - headR * 0.35);
    g.quadraticCurveTo(cx + headR * 0.2, headY - headR * 0.72, cx - headR * 0.95, headY - headR * 0.05);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = S * 0.014;
    g.stroke();
  } else if (look.head === "bandana") {
    g.fillStyle = pal.trim;
    g.beginPath();
    g.moveTo(cx - headR * 1.0, headY - headR * 0.42);
    g.quadraticCurveTo(cx, headY - headR * 1.12, cx + headR * 1.0, headY - headR * 0.42);
    g.quadraticCurveTo(cx, headY - headR * 0.82, cx - headR * 1.0, headY - headR * 0.16);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = S * 0.014;
    g.stroke();
    // knot tails
    g.beginPath();
    g.moveTo(cx + headR * 0.9, headY - headR * 0.42);
    g.quadraticCurveTo(cx + headR * 1.5, headY - headR * 0.1, cx + headR * 1.34, headY + headR * 0.5);
    g.lineWidth = S * 0.026;
    g.strokeStyle = pal.trim;
    g.stroke();
  } else if (look.head === "helmet") {
    g.fillStyle = pal.trimDark;
    g.beginPath();
    g.arc(cx, headY - headR * 0.05, headR * 1.06, Math.PI * 1.02, Math.PI * 1.98);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = S * 0.016;
    g.stroke();
    g.fillStyle = pal.trim;
    g.beginPath();
    g.roundRect(cx - headR * 0.55, headY - headR * 0.16, headR * 1.1, headR * 0.16, headR * 0.08);
    g.fill();
  } else if (look.head === "mask") {
    // pull the mask down over the jaw, leaving the lenses above
    g.fillStyle = pal.suit;
    g.beginPath();
    g.moveTo(cx - headR * 0.86, headY + headR * 0.12);
    g.quadraticCurveTo(cx, headY + headR * 1.34, cx + headR * 0.86, headY + headR * 0.12);
    g.quadraticCurveTo(cx, headY + headR * 0.4, cx - headR * 0.86, headY + headR * 0.12);
    g.closePath();
    g.fill();
    g.strokeStyle = ink;
    g.lineWidth = S * 0.014;
    g.stroke();
  }

  g.restore();
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  colorIdx: number,
  simFrame: number,
  dim: boolean
) {
  const look = lookFor(f);
  const pal = paletteFor(f, colorIdx);

  // ground shadow lives in world space so it stays put while the body animates
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(f.x, FLOOR - f.y + 2, 26 * look.size * look.bulk, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Paint the figure once, flatten a copy into an outline colour, then let the
  // GPU stamp that silhouette around the figure. Nine paints per fighter was
  // costing frames; this is one paint plus a handful of tiny blits.
  const fig = surface("fig");
  fig.save();
  fig.translate(SPR_FEET_X, SPR_FEET_Y);
  fig.scale(1, -1);
  paintFigure(fig, f, look, pal, simFrame, null);
  fig.restore();

  const sil = surface("sil");
  sil.drawImage(fig.canvas, 0, 0);
  sil.globalCompositeOperation = "source-in";
  sil.fillStyle = OUTLINE;
  sil.fillRect(0, 0, SPR_W, SPR_H);
  sil.globalCompositeOperation = "source-over";

  const g = surface("spr");
  for (const [ox, oy] of HALO) g.drawImage(sil.canvas, ox, oy);
  g.drawImage(fig.canvas, 0, 0);

  if (f.flash > 0) {
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = `rgba(255,255,255,${Math.min(0.72, f.flash / 9)})`;
    g.fillRect(0, 0, SPR_W, SPR_H);
    g.globalCompositeOperation = "source-over";
  }

  const k = 2 * look.size;
  ctx.save();
  ctx.translate(f.x, FLOOR - f.y);
  if (f.st === FS.KO) {
    ctx.rotate(-f.facing * 1.45);
    ctx.translate(-4, 2);
  }
  ctx.scale(f.facing * k, k);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = dim ? 0.55 : 1;
  ctx.drawImage(g.canvas, -SPR_FEET_X, -SPR_FEET_Y);
  ctx.restore();

  if (f.invuln > 0 && f.st !== FS.INTRO) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#79a8ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(f.x - 24, FLOOR - f.y - bodyH(f) - 8, 48, bodyH(f) + 8);
    ctx.restore();
  }

  // assist marker
  if (f.st === FS.ASSIST || (!f.active && f.onScreen)) {
    ctx.save();
    ctx.fillStyle = "rgba(121,168,255,0.9)";
    ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("ASSIST", f.x, FLOOR - f.y - bodyH(f) - 14);
    ctx.restore();
  }
}


function attackPunchPhase(f: Fighter): number {
  if (f.st !== FS.ATTACK) return 0;
  const mv = f.move;
  const phase = (f.moveFrame % 18) / 18;
  if (mv === -1) return 0;
  // extend during the active window, retract after
  const t = Math.min(1, f.moveFrame / 7);
  if (t < 1) return t;
  const back = Math.max(0, 1 - (f.moveFrame - 10) / 8);
  return Math.max(0, Math.min(1, Math.min(1, f.moveFrame / 7)) * (0.4 + 0.6 * back) + phase * 0);
}

// ------------------------------------------------------------------- hud
function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pct: number,
  right: boolean,
  colors: [string, string]
) {
  ctx.fillStyle = "rgba(6,6,12,0.78)";
  rr(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const fw = Math.max(0, Math.min(1, pct)) * (w - 4);
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  if (right) {
    rr(ctx, x + w - 2 - fw, y + 2, fw, h - 4, (h - 4) / 2);
  } else {
    rr(ctx, x + 2, y + 2, fw, h - 4, (h - 4) / 2);
  }
  ctx.fill();
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  cfg: MatchConfig,
  names: [string, string]
) {
  ctx.save();
  ctx.textBaseline = "middle";

  for (let t = 0; t < 2; t++) {
    const right = t === 1;
    const x = right ? VIEW_W - 480 : 40;
    const y = 34;
    const active = s.fighters[t * 3 + s.active[t]];
    const pct = active.hp / active.maxHp;
    drawBar(ctx, x, y, 440, 26, pct, right, ["#3f80ff", "#79a8ff"]);

    // pixel-ish segment mask
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#04040a";
    for (let i = 0; i < 22; i++) {
      const sx = x + 4 + (i * 436) / 22;
      ctx.beginPath();
      ctx.moveTo(sx, y + 3);
      ctx.lineTo(sx, y + 23);
      ctx.stroke();
    }
    ctx.restore();

    // teammate pips
    for (let slot = 0; slot < 3; slot++) {
      const f = s.fighters[t * 3 + slot];
      const c = colorsFor(f.char, cfg.colors[t]?.[slot] ?? 0);
      const px = right ? x + 440 - 26 - slot * 30 : x + slot * 30;
      ctx.fillStyle = f.ko ? "rgba(90,20,30,0.9)" : hex(c.primary);
      rr(ctx, px, y + 32, 24, 16, 5);
      ctx.fill();
      ctx.strokeStyle = slot === s.active[t] ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = slot === s.active[t] ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "700 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(ROSTER[f.char].short, px + 12, y + 41);
    }

    // name
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.textAlign = right ? "right" : "left";
    ctx.fillText(names[t].toUpperCase(), right ? x + 440 : x, y + 66);

    // meter
    const meter = s.fighters[t * 3 + s.active[t]].meter;
    for (let b = 0; b < 5; b++) {
      const bx = right ? x + 440 - 84 - b * 86 : x + b * 86;
      const filled = Math.max(0, Math.min(1, (meter - b * 100) / 100));
      ctx.fillStyle = "rgba(6,6,12,0.8)";
      rr(ctx, bx, VIEW_H - 58, 80, 16, 5);
      ctx.fill();
      if (filled > 0) {
        ctx.fillStyle = filled >= 1 ? "#79a8ff" : "#3f80ff";
        rr(ctx, bx + 2, VIEW_H - 56, 76 * filled, 12, 4);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 1;
      rr(ctx, bx, VIEW_H - 58, 80, 16, 5);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "600 10px JetBrains Mono, monospace";
    ctx.textAlign = right ? "right" : "left";
    ctx.fillText("HYPER", right ? x + 440 : x, VIEW_H - 72);
  }

  // timer
  const secs = Math.ceil(s.timer / 60);
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(6,6,12,0.82)";
  rr(ctx, VIEW_W / 2 - 62, 22, 124, 62, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  rr(ctx, VIEW_W / 2 - 62, 22, 124, 62, 16);
  ctx.stroke();
  ctx.fillStyle = secs <= 10 ? "#ff6b81" : "#f8fafc";
  ctx.font = "800 40px JetBrains Mono, monospace";
  ctx.fillText(String(Math.max(0, secs)).padStart(2, "0"), VIEW_W / 2, 58);

  // combo counter
  if (s.comboHits > 1 && s.comboTeam >= 0) {
    const right = s.comboTeam === 1;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.textAlign = right ? "right" : "left";
    ctx.fillStyle = "#79a8ff";
    ctx.font = "800 34px Inter, system-ui, sans-serif";
    const x = right ? VIEW_W - 60 : 60;
    ctx.fillText(`${s.comboHits} HITS`, x, 170);
    ctx.font = "700 15px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(`${s.lastComboDmg} DMG`, x, 196);
    ctx.restore();
  }

  // announcements
  if (s.announceLife > 0) {
    const a = s.announce;
    const text =
      a === 1 ? "FIGHT!" : a === 2 ? "K.O." : a === 3 ? (s.winner === -1 ? "DRAW" : "WIN") : a === 4 ? "HYPER COMBO" : "";
    if (text) {
      const t = s.announceLife;
      const alpha = Math.min(1, t / 18);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      const size = a === 2 ? 96 : a === 4 ? 40 : 72;
      ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = a === 2 ? "#ff6b81" : a === 4 ? "#79a8ff" : "#ffffff";
      ctx.shadowColor = a === 2 ? "rgba(255,107,129,0.7)" : "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 26;
      ctx.fillText(text, VIEW_W / 2, VIEW_H / 2 - 40);
      ctx.restore();
    }
  }

  // stage label
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.font = "600 11px JetBrains Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillText(stageName(cfg.stage), VIEW_W / 2, VIEW_H - 30);

  ctx.restore();
}

// ------------------------------------------------------------------ main
export interface DrawOpts {
  names: [string, string];
  showHitboxes?: boolean;
  netcode?: string;
  fps?: number;
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  s: SimState,
  cfg: MatchConfig,
  opts: DrawOpts
) {
  const cam = camera(s);
  const shake = s.shake;
  ctx.save();
  if (shake > 0.2) {
    ctx.translate(
      Math.sin(s.frame * 1.7) * shake * 0.6,
      Math.cos(s.frame * 2.1) * shake * 0.5
    );
  }
  drawStage(ctx, cam, cfg.stage, s.frame);

  withCam(ctx, cam, () => {
    // assists behind
    for (let i = 0; i < 6; i++) {
      const f = s.fighters[i];
      if (!f.onScreen || f.active) continue;
      drawFighter(ctx, f, cfg.colors[f.team]?.[f.slot] ?? 0, s.frame, true);
    }
    for (let i = 0; i < 6; i++) {
      const f = s.fighters[i];
      if (!f.onScreen || !f.active) continue;
      drawFighter(ctx, f, cfg.colors[f.team]?.[f.slot] ?? 0, s.frame, false);
    }

    // projectiles
    for (const p of s.projectiles) {
      if (!p.alive) continue;
      const g = ctx.createRadialGradient(p.x, FLOOR - p.y, 2, p.x, FLOOR - p.y, p.w);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, "#79a8ff");
      g.addColorStop(1, "rgba(63,128,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, FLOOR - p.y, p.w * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // particles
    for (const p of s.particles) {
      if (!p.alive) continue;
      const a = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = hex(p.color);
      ctx.beginPath();
      ctx.arc(p.x, FLOOR - p.y, p.size * (p.kind === 2 ? a + 0.4 : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // hit spark
    if (s.hitsparkLife > 0) {
      const a = s.hitsparkLife / 12;
      const x = s.hitsparkX;
      const y = FLOOR - s.hitsparkY;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(x, y, 2, x, y, 60);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, "#79a8ff");
      g.addColorStop(1, "rgba(63,128,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + s.frame * 0.2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12);
        ctx.lineTo(x + Math.cos(ang) * (28 + a * 34), y + Math.sin(ang) * (28 + a * 34));
        ctx.stroke();
      }
      ctx.restore();
    }

    if (opts.showHitboxes) {
      for (let i = 0; i < 6; i++) {
        const f = s.fighters[i];
        if (!f.onScreen) continue;
        const hb = f.crouch ? 78 : 116;
        ctx.strokeStyle = "rgba(80,255,120,0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(f.x - 25, FLOOR - f.y - hb, 50, hb);
      }
    }
  });
  ctx.restore();

  drawHud(ctx, s, cfg, opts.names);

  if (opts.netcode) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    rr(ctx, 40, VIEW_H - 96, 300, 26, 6);
    ctx.fill();
    ctx.fillStyle = "#79a8ff";
    ctx.font = "500 12px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(opts.netcode, 52, VIEW_H - 83);
    ctx.restore();
  }
}

export { FLOOR, ROUND_FRAMES };
