// Match screen: owns the canvas, the fixed 60 Hz loop, input sampling and the
// online rollback session. Offline modes step the simulation directly; online
// modes step it through RollbackSession so a late remote input rewinds state.

import { RollbackSession } from "../net/rollback";
import { createState, stepGame, resetTraining, teamHealth } from "../game/engine";
import { ROSTER, colorsFor, hex } from "../game/roster";
import { input } from "../game/input";
import { VIEW_W, VIEW_H, drawGame, stageName } from "../game/render";
import { isMuted, playSfx, startMusic, stopMusic, toggleMuted } from "../game/audio";
import { FS, type MatchConfig, type SimState } from "../game/types";
import type { RtcPeer } from "../net/peer";
import { el, button, toast } from "./dom";

export interface MatchSetup {
  cfg: MatchConfig;
  names: [string, string];
  mode: "online" | "arcade" | "local" | "training";
  localTeam: 0 | 1;
  net?: { peer: RtcPeer; session: RollbackSession };
  netLabel?: () => string;
  round?: number;
  onExit: (result: { winner: number; winnerName: string } | null) => void;
  onNextArcade?: (won: boolean) => void;
  onRematch?: () => void;
}

const STEP_MS = 1000 / 60;

export class MatchScreen {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private setup: MatchSetup;
  private offline: SimState | null;
  private session: RollbackSession | null;

  /** Always read through the session: rollback replaces the state object. */
  private get state(): SimState {
    return this.session ? this.session.state : (this.offline as SimState);
  }
  private raf = 0;
  private acc = 0;
  private last = 0;
  private paused = false;
  private finished = false;
  private finishTimer = 0;
  private frames = 0;
  private fpsT = 0;
  private fps = 60;
  private hudEl: HTMLElement;
  private disposed = false;
  private startTime = 0;
  private prevSpark = 0;
  private prevProj = 0;
  private prevAnnounce = 0;
  private prevActive: [number, number] = [-1, -1];
  private prevAir: boolean[] = [false, false, false, false, false, false];

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.root = el("div", { class: "screen match-screen" });
    this.canvas = el("canvas", { class: "game-canvas", attrs: { width: VIEW_W, height: VIEW_H } });
    const c2d = this.canvas.getContext("2d", { alpha: false });
    if (!c2d) throw new Error("Canvas 2D is unavailable in this browser.");
    this.ctx = c2d;

    this.offline = setup.net ? null : createState(setup.cfg);
    this.session = setup.net ? setup.net.session : null;

    this.hudEl = el("div", { class: "match-hud" });
    this.root.append(el("div", { class: "canvas-wrap" }, this.canvas), this.hudEl);

    input.enabled = true;
    input.clear();
    input.onEscape = () => this.togglePause();
    this.root.append(this.pauseOverlay());

    if (setup.net) {
      setup.net.peer.setMessageHandler((raw: string) => {
        if (this.session && this.session.receive(raw)) {
          toast("Desync detected — state checksums diverged.", "error");
        }
      });
    }
  }

  element(): HTMLElement {
    return this.root;
  }

  start() {
    this.startTime = performance.now();
    this.last = performance.now();
    startMusic();
    // Debug/verification handle: lets a test harness read the live simulation.
    const self = this;
    (window as unknown as Record<string, unknown>).__mvc2 = {
      get state() { return self.state; },
      get session() { return self.session; },
      get fps() { return self.fps; },
      get finished() { return self.finished; },
      get paused() { return self.paused; },
    };
    this.raf = requestAnimationFrame(this.loop);
    this.renderHud();
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(120, now - this.last);
    this.last = now;

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < 6) {
        this.advance();
        this.acc -= STEP_MS;
        steps++;
        this.frames++;
      }
      if (steps === 6) this.acc = 0;
      this.syncAudio();
    }

    this.fpsT += dt;
    if (this.fpsT >= 500) {
      this.fps = Math.round((this.frames * 1000) / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
      this.renderHud();
    }

    this.render();

    if (this.state.over && !this.finished) {
      this.finishTimer += dt;
      if (this.finishTimer > 1400) {
        this.finished = true;
        this.showResults();
      }
    }
  };

  /** Turns simulation edges into sound: hits, blocks, projectiles, jumps, KOs. */
  private syncAudio() {
    const s = this.state;

    if (s.hitsparkLife > 0 && this.prevSpark === 0) {
      const blocked = s.fighters.some((f) => f.blockstun > 0);
      playSfx(blocked ? "block" : s.announce === 4 ? "heavy" : "hit");
    }
    this.prevSpark = s.hitsparkLife;

    let live = 0;
    for (const p of s.projectiles) if (p.alive) live++;
    if (live > this.prevProj) playSfx("fireball");
    this.prevProj = live;

    if (s.announce !== this.prevAnnounce) {
      if (s.announce === 1 || s.announce === 3) playSfx("round");
      else if (s.announce === 2) playSfx("ko");
      else if (s.announce === 4) playSfx("hyper");
      this.prevAnnounce = s.announce;
    }

    for (let t = 0; t < 2; t++) {
      const active = s.active[t];
      if (active !== this.prevActive[t]) {
        if (this.prevActive[t] >= 0) playSfx("tag");
        this.prevActive[t] = active;
      }
    }

    for (let i = 0; i < 6; i++) {
      const f = s.fighters[i];
      if (f.airborne && !this.prevAir[i]) playSfx("jump");
      else if (!f.airborne && this.prevAir[i] && f.st === FS.LAND) playSfx("land");
      this.prevAir[i] = f.airborne;
    }
  }

  private advance() {
    const m0 = this.localMask(0);
    const m1 = this.localMask(1);

    if (this.session) {
      const mask = this.setup.localTeam === 0 ? m0 : m1;
      this.session.advance(mask);
      return;
    }
    stepGame(this.offline as SimState, this.setup.cfg, m0, m1);
  }

  private localMask(slot: 0 | 1): number {
    const mode = this.setup.mode;
    if (mode === "local") {
      return slot === 0
        ? input.maskFor(input.p1) | input.padMask(0)
        : input.maskFor(input.p2) | input.padMask(1);
    }
    if (slot === 0) return input.maskFor(input.p1) | input.padMask(0);
    // slot 1 is CPU/dummy when the engine handles it
    if (this.setup.cfg.cpu || this.setup.cfg.training) return 0;
    return input.maskFor(input.p2) | input.padMask(1);
  }

  private render() {
    const s = this.state;
    let netcode: string | undefined;
    if (this.session) {
      const st = this.session.stats();
      netcode =
        `ROLLBACK ${st.rollbacks} · LAG ${st.remoteLagFrames}f · ` +
        `${st.predicted ? "PREDICT" : "SYNC"} · ${this.setup.net ? this.setup.net.peer.state.toUpperCase() : ""}`;
    }
    drawGame(this.ctx, s, this.setup.cfg, {
      names: this.setup.names,
      netcode,
    });
  }

  private renderHud() {
    const s = this.state;
    const cfg = this.setup.cfg;
    this.hudEl.replaceChildren();

    const bar = el("div", { class: "match-bar" });

    const side = (team: number) => {
      const group = el("div", { class: `mb-side ${team === 1 ? "right" : ""}` });
      const active = s.fighters[team * 3 + s.active[team]];
      const teamChars = cfg.teams[team];
      group.append(el("div", { class: "mb-name", text: this.setup.names[team].toUpperCase() }));
      const chips = el("div", { class: "mb-chars" });
      teamChars.forEach((ci, slot) => {
        const f = s.fighters[team * 3 + slot];
        const c = colorsFor(ci, cfg.colors[team]?.[slot] ?? 0);
        const chip = el("div", {
          class: `mb-chip ${f.ko ? "ko" : ""} ${slot === s.active[team] ? "active" : ""}`,
          style: { background: f.ko ? "#3a1a22" : hex(c.primary) },
          title: ROSTER[ci].name,
          text: ROSTER[ci].short,
        });
        chips.append(chip);
      });
      group.append(chips);
      group.append(
        el("div", { class: "mb-hp" },
          el("span", { text: `${Math.round((active.hp / active.maxHp) * 100)}%` }),
          el("span", { class: "mb-meter", text: `${Math.floor(active.meter / 100)} BARS` })
        )
      );
      return group;
    };

    bar.append(side(0));
    bar.append(el("div", { class: "mb-mid" },
      el("span", { class: "mb-stage", text: stageName(cfg.stage) }),
      el("span", { class: "mb-fps", text: `${this.fps} FPS` })
    ));
    bar.append(side(1));
    this.hudEl.append(bar);

    const actions = el("div", { class: "match-actions" });
    if (this.setup.mode === "training") {
      actions.append(
        button("Reset Positions", "ghost sm", () => {
          resetTraining(this.state, this.setup.cfg);
          toast("Positions reset.", "ok");
        }),
        button("Dummy: " + (["Stand", "Block", "Jump", "Attack"][this.setup.cfg.dummy] ?? "Stand"), "ghost sm", () => {
          this.setup.cfg.dummy = (this.setup.cfg.dummy + 1) % 4;
          this.renderHud();
        })
      );
    }
    actions.append(
      button("Pause", "ghost sm", () => this.togglePause()),
      button("Controls", "ghost sm", () => this.showControls()),
      button(isMuted() ? "Sound: Off" : "Sound: On", "ghost sm", () => {
        toggleMuted();
        this.renderHud();
      })
    );
    this.hudEl.append(actions);
  }

  private pauseOverlay(): HTMLElement {
    const o = el("div", { class: "overlay pause hidden" });
    const panel = el("div", { class: "panel" },
      el("h2", { text: "Paused" }),
      el("div", { class: "panel-actions" },
        button("Resume", "primary", () => this.togglePause()),
        button("Restart", "ghost", () => {
          this.disposed = true;
          cancelAnimationFrame(this.raf);
          this.setup.onExit(null);
        }),
        button("Quit to menu", "ghost", () => {
          this.disposed = true;
          cancelAnimationFrame(this.raf);
          this.setup.onExit(null);
        })
      )
    );
    o.append(panel);
    o.addEventListener("click", (ev) => {
      if (ev.target === o) this.togglePause();
    });
    return o;
  }

  private togglePause() {
    if (this.finished) return;
    this.paused = !this.paused;
    const o = this.root.querySelector(".overlay.pause");
    if (o) o.classList.toggle("hidden", !this.paused);
    input.clear();
  }

  private showControls() {
    const o = el("div", { class: "overlay" });
    const panel = el("div", { class: "panel wide" },
      el("h2", { text: "Controls" }),
      el("div", { class: "controls-grid" },
        el("div", {},
          el("h3", { text: "Universal" }),
          el("ul", { class: "kv" },
            el("li", {}, el("b", { text: "A / S" }), " Light / Heavy Punch"),
            el("li", {}, el("b", { text: "Z / X" }), " Light / Heavy Kick"),
            el("li", {}, el("b", { text: "Q / W" }), " Assist 1 / Assist 2"),
            el("li", {}, el("b", { text: "Arrows" }), " Move, jump, crouch")
          )
        ),
        el("div", {},
          el("h3", { text: "Commands" }),
          el("ul", { class: "kv" },
            el("li", {}, el("b", { text: "↓ ↘ → + P" }), " Special 1"),
            el("li", {}, el("b", { text: "→ ↓ ↘ + P" }), " Special 2 (DP)"),
            el("li", {}, el("b", { text: "Hold ← then → + P" }), " Charge special"),
            el("li", {}, el("b", { text: "↓ ↘ → + LP+HP" }), " Hyper Combo")
          )
        ),
        el("div", {},
          el("h3", { text: "Systems" }),
          el("ul", { class: "kv" },
            el("li", {}, el("b", { text: "LP + LK" }), " Tag out"),
            el("li", {}, el("b", { text: "Crouch HP" }), " Launcher (air combo)"),
            el("li", {}, el("b", { text: "Block + HP+HK" }), " Pushblock"),
            el("li", {}, el("b", { text: "↓ then ↑" }), " Super jump")
          )
        )
      ),
      button("Close", "primary", () => o.remove())
    );
    o.append(panel);
    o.addEventListener("click", (ev) => {
      if (ev.target === o) o.remove();
    });
    this.root.append(o);
  }

  private showResults() {
    const s = this.state;
    const winner = s.winner;
    const winnerName = winner >= 0 ? this.setup.names[winner] : "Nobody";
    const panel = el("div", { class: "overlay results" });
    const inner = el("div", { class: "results-panel" });
    inner.append(
      el("div", { class: "results-kicker", text: winner < 0 ? "TIME OVER" : "MATCH COMPLETE" }),
      el("h1", { text: winner < 0 ? "DRAW" : `${winnerName.toUpperCase()} WINS` })
    );

    if (this.setup.mode === "arcade" && this.setup.onNextArcade) {
      const won = winner === this.setup.localTeam;
      inner.append(
        el("p", { class: "results-sub", text: won ? "Stage cleared. Next opponent incoming." : "You were defeated." }),
        el("div", { class: "panel-actions" },
          button(won ? "Continue" : "Retry stage", "primary", () => {
            this.disposed = true;
            cancelAnimationFrame(this.raf);
            this.setup.onNextArcade!(won);
          }),
          button("Quit", "ghost", () => {
            this.disposed = true;
            cancelAnimationFrame(this.raf);
            this.setup.onExit({ winner, winnerName });
          })
        )
      );
    } else if (this.setup.mode === "training") {
      inner.append(
        el("p", { class: "results-sub", text: "Training round ended." }),
        button("Reset", "primary", () => {
          resetTraining(this.state, this.setup.cfg);
          this.finished = false;
          this.finishTimer = 0;
          panel.remove();
        })
      );
    } else {
      inner.append(
        el("p", { class: "results-sub", text: `${this.setup.names[0]} vs ${this.setup.names[1]}` }),
        el("div", { class: "panel-actions" },
          this.setup.onRematch
            ? button("Rematch", "primary", () => {
                this.disposed = true;
                cancelAnimationFrame(this.raf);
                this.setup.onRematch!();
              })
            : null,
          button(this.setup.mode === "online" ? "Return to room" : "Continue", "primary", () => {
            this.disposed = true;
            cancelAnimationFrame(this.raf);
            this.setup.onExit({ winner, winnerName });
          })
        )
      );
    }

    panel.append(inner);
    this.root.append(panel);
    this.paused = true;
  }

  dispose() {
    this.disposed = true;
    stopMusic();
    cancelAnimationFrame(this.raf);
    input.enabled = false;
    input.onEscape = null;
    input.clear();
  }
}

export { STEP_MS, teamHealth, FS };
