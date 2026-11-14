// Team select: 3 characters, an assist variant per character, and a colour
// slot per character. All 56 characters and all 6 colour slots are available
// from the first frame — there is no unlock state anywhere in the app.

import { COLORS_PER_CHAR, ROSTER, colorsFor, hex } from "../game/roster";
import type { CharacterDef } from "../game/types";
import { el, button, icon, toast } from "./dom";

export interface TeamPick {
  chars: number[];
  assists: number[];
  colors: number[];
}

export const emptyPick = (): TeamPick => ({ chars: [], assists: [], colors: [] });

export function portrait(def: CharacterDef, colorIdx: number, size = 64, showName = false): HTMLElement {
  const c = colorsFor(ROSTER.indexOf(def), colorIdx);
  const tile = el("div", {
    class: "portrait",
    style: {
      width: `${size}px`,
      height: `${Math.round(size * 1.06)}px`,
      background: `linear-gradient(150deg, ${hex(c.primary)} 0%, ${hex(c.secondary)} 100%)`,
    },
    title: `${def.name} — ${def.arch}`,
  });
  tile.append(
    el("div", { class: "portrait-figure", style: { background: hex(c.skin) } }),
    el("div", { class: "portrait-short", text: def.short }),
    el("div", { class: "portrait-glow", style: { background: hex(c.accent) } })
  );
  if (showName) tile.append(el("div", { class: "portrait-name", text: def.name }));
  return tile;
}

export interface CharSelectOpts {
  title: string;
  subtitle?: string;
  /** who is picking */
  mode: "solo" | "versus" | "online";
  side: 0 | 1;
  initial?: TeamPick;
  /** preset team for the other side (arcade opponent / training dummy) */
  opponentPreview?: TeamPick | null;
  opponentName?: string;
  onBack: () => void;
  onConfirm: (pick: TeamPick) => void;
  /** online: fired whenever the local pick changes */
  onPickChange?: (pick: TeamPick) => void;
  lockLabel?: string;
}

const ASSIST_NAMES = ["α Projectile", "β Anti-Air"];

export class CharSelect {
  private root: HTMLElement;
  private opts: CharSelectOpts;
  private pick: TeamPick;
  private focused = 0;

  constructor(opts: CharSelectOpts) {
    this.opts = opts;
    this.pick = opts.initial ? {
      chars: [...opts.initial.chars],
      assists: [...opts.initial.assists],
      colors: [...opts.initial.colors],
    } : emptyPick();
    this.root = el("div", { class: "screen select-screen" });
    this.render();
  }

  element(): HTMLElement {
    return this.root;
  }

  current(): TeamPick {
    return this.pick;
  }

  private add(idx: number) {
    if (this.pick.chars.includes(idx)) {
      this.remove(this.pick.chars.indexOf(idx));
      return;
    }
    if (this.pick.chars.length >= 3) {
      this.pick.chars[2] = idx;
      this.pick.assists[2] = 0;
      this.pick.colors[2] = 0;
    } else {
      this.pick.chars.push(idx);
      this.pick.assists.push(0);
      this.pick.colors.push(0);
    }
    this.changed();
  }

  private remove(slot: number) {
    if (slot < 0 || slot >= this.pick.chars.length) return;
    this.pick.chars.splice(slot, 1);
    this.pick.assists.splice(slot, 1);
    this.pick.colors.splice(slot, 1);
    this.changed();
  }

  private changed() {
    this.opts.onPickChange?.(this.pick);
    this.render();
  }

  private render() {
    const o = this.opts;
    this.root.replaceChildren();

    const header = el("header", { class: "screen-head" },
      el("div", { class: "head-left" },
        button("", "ghost icon-btn", o.onBack, { html: "" }).appendChild(icon("back"))!.parentElement as HTMLElement,
        el("div", {},
          el("h1", { text: o.title }),
          o.subtitle ? el("p", { class: "sub", text: o.subtitle }) : null
        )
      ),
      el("div", { class: "head-right" },
        el("span", { class: "pill", text: "56 / 56 UNLOCKED" }),
        el("span", { class: "pill cyan", text: "ALL COLORS" })
      )
    );
    this.root.append(header);

    const body = el("div", { class: "select-body" });

    const teamStrip = el("div", { class: "team-strip" });
    for (let slot = 0; slot < 3; slot++) {
      const ci = this.pick.chars[slot];
      const def = ci !== undefined ? ROSTER[ci] : null;
      const card = el("div", {
        class: `team-slot ${def ? "filled" : "empty"} ${this.focused === slot ? "focus" : ""}`,
        on: { click: () => { this.focused = slot; this.render(); } },
      });
      if (def) {
        card.append(portrait(def, this.pick.colors[slot] ?? 0, 78, true));
        const actions = el("div", { class: "slot-actions" },
          el("button", {
            class: "chip",
            text: ASSIST_NAMES[this.pick.assists[slot] ?? 0],
            title: "Toggle assist type",
            on: {
              click: (ev) => {
                ev.stopPropagation();
                this.pick.assists[slot] = ((this.pick.assists[slot] ?? 0) + 1) % 2;
                this.changed();
              },
            },
          }),
          el("button", {
            class: "chip",
            text: `COLOR ${(this.pick.colors[slot] ?? 0) + 1}/${COLORS_PER_CHAR}`,
            title: "Cycle colour — all slots unlocked",
            on: {
              click: (ev) => {
                ev.stopPropagation();
                this.pick.colors[slot] = ((this.pick.colors[slot] ?? 0) + 1) % COLORS_PER_CHAR;
                this.changed();
              },
            },
          }),
          el("button", {
            class: "chip danger",
            text: "REMOVE",
            on: { click: (ev) => { ev.stopPropagation(); this.remove(slot); } },
          })
        );
        card.append(actions);
      } else {
        card.append(
          el("div", { class: "slot-empty-mark", text: String(slot + 1) }),
          el("div", { class: "slot-empty-label", text: "PICK A FIGHTER" })
        );
      }
      teamStrip.append(card);
    }
    body.append(teamStrip);

    if (o.opponentPreview) {
      const opp = el("div", { class: "opp-preview" },
        el("span", { class: "label", text: (o.opponentName ?? "OPPONENT").toUpperCase() }),
        el("div", { class: "opp-chars" },
          ...o.opponentPreview.chars.map((ci, i) =>
            portrait(ROSTER[ci], o.opponentPreview!.colors[i] ?? 0, 44)
          )
        )
      );
      body.append(opp);
    }

    const grid = el("div", { class: "roster-grid" });
    for (const [label, side] of [["MARVEL", "marvel"], ["CAPCOM", "capcom"]] as const) {
      const col = el("div", { class: "roster-col" });
      col.append(el("div", { class: "roster-col-head" }, el("span", { text: label }), el("span", { class: "count", text: "28" })));
      const cells = el("div", { class: "roster-cells" });
      ROSTER.forEach((def, idx) => {
        if (def.side !== side) return;
        const picked = this.pick.chars.indexOf(idx);
        const cell = el("button", {
          class: `char-cell ${picked >= 0 ? "picked" : ""}`,
          title: `${def.name} — ${def.tagline}`,
          on: { click: () => this.add(idx) },
        });
        cell.append(portrait(def, this.pick.colors[picked] ?? 0, 56));
        cell.append(el("span", { class: "cell-name", text: def.name }));
        if (picked >= 0) cell.append(el("span", { class: "cell-order", text: String(picked + 1) }));
        cells.append(cell);
      });
      col.append(cells);
      grid.append(col);
    }
    body.append(grid);

    this.root.append(body);

    const footer = el("footer", { class: "select-foot" },
      el("div", { class: "hint", text: this.pick.chars.length === 3
        ? "Team ready. Tap a chosen fighter again to swap it out."
        : `Choose ${3 - this.pick.chars.length} more fighter${3 - this.pick.chars.length === 1 ? "" : "s"}. Assist type and colour are on each slot.` }),
      button(o.lockLabel ?? "Lock In", "primary lg", () => {
        if (this.pick.chars.length !== 3) {
          toast("Pick three fighters first.", "error");
          return;
        }
        o.onConfirm(this.pick);
      }, { attrs: { disabled: this.pick.chars.length !== 3 } })
    );
    this.root.append(footer);
  }
}
