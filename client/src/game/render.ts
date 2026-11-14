// Canvas renderer. All fighters are drawn procedurally — no Capcom/Marvel art
// is bundled, the shapes and palettes are generated from the roster hue seed.
// Rendering may use trigonometry; the simulation may not.

import { ROSTER, colorsFor, hex } from "./roster";
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

function withCam(ctx: CanvasRenderingContext2D, cam: Cam, fn: () => void) {
  ctx.save();
  ctx.translate(VIEW_W / 2, FLOOR + 20);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -20);
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
    ["#10101c", "#2a1230", "#3b1340"],
    ["#0a1420", "#123044", "#1d4257"],
    ["#0a0a14", "#141a38", "#2a1a4a"],
    ["#0b1210", "#12241c", "#1a3528"],
    ["#150f0a", "#2c1c14", "#42241a"],
    ["#0d0a14", "#20123a", "#341a52"],
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
  lg.addColorStop(0, "rgba(255,90,140,0.10)");
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
function bodyH(f: Fighter): number {
  return f.crouch ? 78 : 116;
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  colorIdx: number,
  simFrame: number,
  dim: boolean
) {
  const c = colorsFor(f.char, colorIdx);
  const bx = f.x;
  const by = FLOOR - f.y;
  const h = bodyH(f);
  const face = f.facing;

  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(face, 1);
  if (dim) ctx.globalAlpha = 0.62;

  // shadow
  ctx.save();
  ctx.scale(1 / Math.max(0.4, face), 1);
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.beginPath();
  ctx.ellipse(0, 2, 30 - f.y * 0.06, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (f.st === FS.KO) {
    ctx.rotate(-face * 1.35);
    ctx.translate(0, 26);
  }

  const lean =
    f.st === FS.HITSTUN ? -0.16 * face : f.st === FS.ATTACK ? 0.07 : f.st === FS.WALK_F ? 0.05 : 0;
  const bob = Math.sin(simFrame * 0.14) * 2;

  ctx.rotate(lean * 0.4);
  ctx.translate(0, bob);

  const hipY = -h * 0.46;
  const shoulderY = -h * 0.82;

  // legs
  const legSwing = f.st === FS.WALK_F || f.st === FS.WALK_B ? Math.sin(simFrame * 0.3) * 10 : 0;
  const airTuck = f.airborne ? 14 : 0;
  ctx.strokeStyle = hex(c.secondary);
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, hipY);
  ctx.lineTo(-7 + legSwing, -6 - airTuck);
  ctx.moveTo(5, hipY);
  ctx.lineTo(7 - legSwing, -6 - airTuck);
  ctx.stroke();

  // torso
  const tg = ctx.createLinearGradient(-18, shoulderY, 18, hipY);
  tg.addColorStop(0, hex(c.primary));
  tg.addColorStop(1, hex(c.secondary));
  ctx.fillStyle = tg;
  rr(ctx, -17, shoulderY, 34, hipY - shoulderY + 8, 12);
  ctx.fill();

  // chest emblem
  ctx.fillStyle = hex(c.accent);
  ctx.globalAlpha = dim ? 0.36 : 0.9;
  rr(ctx, -8, shoulderY + 12, 16, 12, 5);
  ctx.fill();
  ctx.globalAlpha = dim ? 0.62 : 1;

  // head
  ctx.fillStyle = hex(c.skin);
  ctx.beginPath();
  ctx.arc(3, shoulderY - 13, 13, 0, Math.PI * 2);
  ctx.fill();
  // mask / hair
  ctx.fillStyle = hex(c.primary);
  ctx.beginPath();
  ctx.arc(3, shoulderY - 16, 13, Math.PI * 1.05, Math.PI * 2.05);
  ctx.fill();
  // eye
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(11, shoulderY - 16, 4, 3);

  // arms — extended based on the active move
  const moves = ROSTER[f.char];
  ctx.strokeStyle = hex(c.skin);
  ctx.lineWidth = 9;
  const punchPhase = attackPunchPhase(f);
  const isKick = f.move >= 2 && f.move <= 3 || f.move === 5 || f.move === 7 || f.move >= 10;
  const armX = 16 + punchPhase * 44;
  const armY = shoulderY + 6 - punchPhase * 6;
  ctx.beginPath();
  ctx.moveTo(4, shoulderY + 8);
  ctx.lineTo(armX, armY);
  ctx.stroke();
  // glove
  ctx.fillStyle = hex(c.accent);
  ctx.beginPath();
  ctx.arc(armX, armY, 7 + punchPhase * 3, 0, Math.PI * 2);
  ctx.fill();
  // back arm
  ctx.strokeStyle = hex(c.skin);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-4, shoulderY + 10);
  ctx.lineTo(-14 - punchPhase * 6, shoulderY + 22);
  ctx.stroke();

  // kicking leg extends instead
  if (isKick && punchPhase > 0.05) {
    ctx.strokeStyle = hex(c.secondary);
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(6, hipY);
    ctx.lineTo(6 + punchPhase * 54, hipY + 10 - punchPhase * 34);
    ctx.stroke();
    ctx.fillStyle = hex(c.accent);
    ctx.beginPath();
    ctx.arc(6 + punchPhase * 54, hipY + 10 - punchPhase * 34, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  // hit flash
  if (f.flash > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,120,150,${f.flash / 8})`;
    rr(ctx, -22, shoulderY - 26, 46, -shoulderY + 34, 16);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // invulnerability shimmer
  if (f.invuln > 0 && f.st !== FS.INTRO) {
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = "#9be9ff";
    ctx.lineWidth = 2;
    rr(ctx, -22, shoulderY - 26, 46, -shoulderY + 34, 16);
    ctx.stroke();
    ctx.globalAlpha = dim ? 0.62 : 1;
  }

  ctx.restore();

  // assist marker
  if (f.st === FS.ASSIST || (!f.active && f.onScreen)) {
    ctx.save();
    ctx.fillStyle = "rgba(125,249,255,0.85)";
    ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("ASSIST", bx, by - h - 14);
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
    drawBar(ctx, x, y, 440, 26, pct, right, ["#22c55e", "#eab308"]);

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
        ctx.fillStyle = filled >= 1 ? "#f97316" : "#3b82f6";
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
  ctx.fillStyle = secs <= 10 ? "#f43f5e" : "#f8fafc";
  ctx.font = "800 40px JetBrains Mono, monospace";
  ctx.fillText(String(Math.max(0, secs)).padStart(2, "0"), VIEW_W / 2, 58);

  // combo counter
  if (s.comboHits > 1 && s.comboTeam >= 0) {
    const right = s.comboTeam === 1;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.textAlign = right ? "right" : "left";
    ctx.fillStyle = "#fde047";
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
      ctx.fillStyle = a === 2 ? "#f43f5e" : a === 4 ? "#fbbf24" : "#f8fafc";
      ctx.shadowColor = a === 2 ? "rgba(244,63,94,0.8)" : "rgba(0,0,0,0.9)";
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
      g.addColorStop(0.4, "#7df9ff");
      g.addColorStop(1, "rgba(60,120,255,0)");
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
      g.addColorStop(0.35, "#ffe066");
      g.addColorStop(1, "rgba(255,80,80,0)");
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
    ctx.fillStyle = "#7df9ff";
    ctx.font = "600 12px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.fillText(opts.netcode, 52, VIEW_H - 83);
    ctx.restore();
  }
}

export { FLOOR, ROUND_FRAMES };
