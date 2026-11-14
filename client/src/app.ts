// App-level types and persisted settings.

import { P1_KEYS, P2_KEYS, type KeyMap } from "./game/input";

export type ScreenId =
  | "home"
  | "arcade"
  | "online"
  | "local"
  | "training"
  | "gallery"
  | "settings";

export interface Settings {
  name: string;
  signalUrl: string;
  p1: KeyMap;
  p2: KeyMap;
  stage: number;
  timer: number;
  difficulty: number;
  showHitboxes: boolean;
  netcodeOverlay: boolean;
}

const KEY = "mvc2online.settings.v1";

export const defaultSettings = (): Settings => ({
  name: "",
  signalUrl: "",
  p1: { ...P1_KEYS },
  p2: { ...P2_KEYS },
  stage: 0,
  timer: 99,
  difficulty: 2,
  showHitboxes: false,
  netcodeOverlay: true,
});

export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...parsed,
      p1: { ...base.p1, ...(parsed.p1 ?? {}) },
      p2: { ...base.p2, ...(parsed.p2 ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings simply do not persist */
  }
}

export interface App {
  root: HTMLElement;
  settings: Settings;
  persist(): void;
  go(screen: ScreenId, params?: Record<string, unknown>): void;
  /** Replace the viewport with a full-bleed node (used by match screens). */
  showNode(node: HTMLElement): void;
  back(): void;
  /** depth-1 navigation history for the Back button */
  history: ScreenId[];
}
