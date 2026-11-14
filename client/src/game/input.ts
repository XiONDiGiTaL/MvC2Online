// Keyboard + gamepad input. Each browser maps its own keyboard to its own
// player slot, so two people in two browsers can both use the default layout.

import { INPUT } from "../game/types";

export interface KeyMap {
  up: string;
  down: string;
  left: string;
  right: string;
  lp: string;
  hp: string;
  lk: string;
  hk: string;
  a1: string;
  a2: string;
}

export const P1_KEYS: KeyMap = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  lp: "KeyA",
  hp: "KeyS",
  lk: "KeyZ",
  hk: "KeyX",
  a1: "KeyQ",
  a2: "KeyW",
};

/** Local-versus second player: different physical keys, same actions. */
export const P2_KEYS: KeyMap = {
  up: "Numpad8",
  down: "Numpad2",
  left: "Numpad4",
  right: "Numpad6",
  lp: "KeyJ",
  hp: "KeyK",
  lk: "KeyN",
  hk: "KeyM",
  a1: "KeyU",
  a2: "KeyI",
};

export const ACTION_LABELS: Record<keyof KeyMap, string> = {
  lp: "Light Punch",
  hp: "Heavy Punch",
  lk: "Light Kick",
  hk: "Heavy Kick",
  a1: "Assist 1",
  a2: "Assist 2",
  left: "Move Left",
  right: "Move Right",
  up: "Jump",
  down: "Crouch",
};

const GAME_KEYS = new Set<string>([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab",
]);

export class InputManager {
  private down = new Set<string>();
  private captureCb: ((code: string) => void) | null = null;
  private bound = false;
  enabled = false;
  onEscape: (() => void) | null = null;
  p1: KeyMap = { ...P1_KEYS };
  p2: KeyMap = { ...P2_KEYS };

  attach() {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  detach() {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private onBlur = () => {
    this.down.clear();
  };

  private onKeyDown = (ev: KeyboardEvent) => {
    if (this.captureCb) {
      ev.preventDefault();
      ev.stopPropagation();
      const cb = this.captureCb;
      this.captureCb = null;
      cb(ev.code);
      return;
    }
    if (ev.code === "Escape" && this.onEscape) {
      this.onEscape();
    }
    if (!this.enabled) return;
    if (GAME_KEYS.has(ev.code) || this.isMapped(ev.code)) {
      ev.preventDefault();
    }
    this.down.add(ev.code);
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.down.delete(ev.code);
  };

  private isMapped(code: string): boolean {
    const maps = [this.p1, this.p2];
    for (const m of maps) {
      for (const k of Object.keys(m) as (keyof KeyMap)[]) {
        if (m[k] === code) return true;
      }
    }
    return false;
  }

  captureNext(cb: (code: string) => void) {
    this.captureCb = cb;
  }

  maskFor(map: KeyMap): number {
    let m = 0;
    if (this.down.has(map.left)) m |= INPUT.LEFT;
    if (this.down.has(map.right)) m |= INPUT.RIGHT;
    if (this.down.has(map.up)) m |= INPUT.UP;
    if (this.down.has(map.down)) m |= INPUT.DOWN;
    if (this.down.has(map.lp)) m |= INPUT.LP;
    if (this.down.has(map.hp)) m |= INPUT.HP;
    if (this.down.has(map.lk)) m |= INPUT.LK;
    if (this.down.has(map.hk)) m |= INPUT.HK;
    if (this.down.has(map.a1)) m |= INPUT.A1;
    if (this.down.has(map.a2)) m |= INPUT.A2;
    return m;
  }

  /** First connected gamepad, if any, folded into the mask. */
  padMask(index: number): number {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[index];
    if (!pad || !pad.connected) return 0;
    let m = 0;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (ax < -0.35 || pad.buttons[14]?.pressed) m |= INPUT.LEFT;
    if (ax > 0.35 || pad.buttons[15]?.pressed) m |= INPUT.RIGHT;
    if (ay < -0.35 || pad.buttons[12]?.pressed) m |= INPUT.UP;
    if (ay > 0.35 || pad.buttons[13]?.pressed) m |= INPUT.DOWN;
    if (pad.buttons[0]?.pressed) m |= INPUT.LP;
    if (pad.buttons[1]?.pressed) m |= INPUT.LK;
    if (pad.buttons[2]?.pressed) m |= INPUT.LK;
    if (pad.buttons[3]?.pressed) m |= INPUT.HP;
    if (pad.buttons[5]?.pressed) m |= INPUT.HK;
    if (pad.buttons[6]?.pressed) m |= INPUT.A1;
    if (pad.buttons[7]?.pressed) m |= INPUT.A2;
    return m;
  }

  padCount(): number {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let n = 0;
    for (const p of pads) if (p && p.connected) n++;
    return n;
  }

  clear() {
    this.down.clear();
  }
}

export const input = new InputManager();

export function keyLabel(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code === "Space") return "Space";
  return code;
}
