// All non-match screens. Arcade / Local / Training all feed the same
// deterministic match screen; only the second player's input source differs.

import type { App } from "../app";
import { CharSelect, emptyPick, portrait, type TeamPick } from "./charselect";
import { MatchScreen } from "./match";
import { OnlineView } from "./onlineview";
import { button, copyText, el, icon, toast } from "./dom";
import { ROSTER, COLORS_PER_CHAR, colorsFor, hex } from "../game/roster";
import { movesFor, M } from "../game/engine";
import { input, keyLabel, ACTION_LABELS, P1_KEYS, P2_KEYS, type KeyMap } from "../game/input";
import { stageName } from "../game/render";
import type { MatchConfig } from "../game/types";

const STAGES = 6;

function shell(app: App, title: string, sub: string, body: HTMLElement, right?: HTMLElement): HTMLElement {
  const root = el("div", { class: "screen" });
  root.append(
    el("header", { class: "screen-head" },
      el("div", { class: "head-left" },
        el("div", {},
          el("h1", { text: title }),
          el("p", { class: "sub", text: sub })
        )
      ),
      el("div", { class: "head-right" }, right ?? el("span", { class: "pill", text: "56 FIGHTERS · 3v3" }))
    )
  );
  root.append(body);
  return root;
}

// --------------------------------------------------------------- home
export function homeScreen(app: App): HTMLElement {
  const body = el("div", { class: "home-body" });

  const hero = el("div", { class: "hero" },
    el("div", { class: "hero-copy" },
      el("span", { class: "kicker", text: "XIØN ARCADE · BROWSER NATIVE" }),
      el("h1", { class: "hero-title" },
        el("span", { text: "MARVEL VS. CAPCOM" }),
        el("span", { class: "accent", text: "2" }),
        el("span", { class: "online", text: "ONLINE" })
      ),
      el("p", { class: "hero-sub", text:
        "Three-on-three tag fighting with assists, hyper combos and air combos. " +
        "Built for two browsers: create a room, share the code, play. Rollback netcode, no installs." },
      ),
      el("div", { class: "hero-actions" },
        button("Online Multiplayer", "primary lg", () => app.go("online")),
        button("Arcade", "ghost lg", () => { resetArcade(); app.go("arcade"); }),
        button("Training", "ghost lg", () => app.go("training"))
      )
    ),
    el("div", { class: "hero-visual" },
      el("div", { class: "hexgrid" }),
      el("div", { class: "hero-stack" },
        ...[0, 1, 2].map((i) => {
          const ci = [ROSTER.findIndex((c) => c.id === "wolverine"), ROSTER.findIndex((c) => c.id === "ryu"), ROSTER.findIndex((c) => c.id === "storm")][i];
          return el("div", { class: `hero-card c${i}` }, portrait(ROSTER[ci] ?? ROSTER[0], i, 128, true));
        })
      )
    )
  );
  body.append(hero);

  const modes = el("div", { class: "mode-grid" });
  const modeDefs: [string, string, string, () => void][] = [
    ["Online Multiplayer", "Room codes, invite links, rollback netcode over WebRTC.", "net", () => app.go("online")],
    ["Arcade", `Six-stage ladder against the CPU. Difficulty ramps each fight.`, "play", () => { resetArcade(); app.go("arcade"); }],
    ["Local Versus", "Two players, one keyboard or two gamepads.", "users", () => app.go("local")],
    ["Training", "Dummy behaviour, resets, frame data. Build your combos.", "reset", () => app.go("training")],
    ["Character Gallery", "All 56 fighters, every colour slot, stats and specials.", "lock", () => app.go("gallery")],
    ["Settings", "Remap keys, pick the signal server, tune match rules.", "pad", () => app.go("settings")]
  ];
  for (const [name, desc, ico, go] of modeDefs) {
    modes.append(
      el("button", { class: "mode-card", on: { click: go } },
        el("span", { class: "mode-ico" }, icon(ico)),
        el("span", { class: "mode-name", text: name }),
        el("span", { class: "mode-desc", text: desc })
      )
    );
  }
  body.append(modes);

  const controls = el("div", { class: "home-controls" },
    el("h3", { text: "Default controls" }),
    el("div", { class: "ctrl-rows" },
      ...[
        ["A / S", "Light Punch / Heavy Punch"],
        ["Z / X", "Light Kick / Heavy Kick"],
        ["Q / W", "Assist 1 / Assist 2"],
        ["Arrows", "Move · Jump · Crouch"],
        ["↓ ↘ → + P", "Special"],
        ["LP + LK", "Tag out"]
      ].map(([k, v]) => el("div", { class: "ctrl-row" }, el("kbd", { text: k }), el("span", { text: v })))
    )
  );
  body.append(controls);

  return shell(app, "MvC2Online", "A browser-native 3v3 tag fighter built for two players in two browsers.", body,
    el("div", { class: "head-right" },
      el("span", { class: "pill cyan", text: "ROLLBACK NETCODE" }),
      el("span", { class: "pill", text: "60 FPS SIM" })
    ));
}

// --------------------------------------------------------------- arcade
interface ArcadeState {
  stage: number;
  pick: TeamPick | null;
}
let arcade: ArcadeState = { stage: 0, pick: null };
export function resetArcade() {
  arcade = { stage: 0, pick: null };
}

function seededTeam(seed: number): TeamPick {
  let x = seed * 2654435761;
  const next = () => {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    return x % ROSTER.length;
  };
  const chars: number[] = [];
  while (chars.length < 3) {
    const c = next();
    if (!chars.includes(c)) chars.push(c);
  }
  return { chars, assists: [0, 0, 0], colors: [chars[0] % COLORS_PER_CHAR, 0, 0] };
}

export function arcadeScreen(app: App): HTMLElement {
  if (arcade.stage >= STAGES) {
    const root = shell(app, "Arcade Cleared", "Six stages down. That is the whole ladder.", el("div", { class: "panel center" },
      el("h2", { text: "YOU CLEARED ARCADE MODE" }),
      el("p", { class: "muted", text: "Try online multiplayer — it is the point of this build." }),
      el("div", { class: "panel-actions" },
        button("Play Online", "primary", () => app.go("online")),
        button("Run it again", "ghost", () => { resetArcade(); app.go("arcade"); })
      )
    ));
    return root;
  }

  if (!arcade.pick) {
    const sel = new CharSelect({
      title: "Arcade — Team Select",
      subtitle: `Stage ${arcade.stage + 1} of ${STAGES}. All 56 fighters and every colour are available.`,
      mode: "solo",
      side: 0,
      onBack: () => app.go("home"),
      onConfirm: (pick) => {
        arcade.pick = pick;
        app.go("arcade");
      }
    });
    return sel.element() as HTMLElement;
  }

  const opponent = seededTeam(arcade.stage + 7);
  const cfg: MatchConfig = {
    teams: [arcade.pick.chars, opponent.chars],
    assists: [arcade.pick.assists, opponent.assists],
    colors: [arcade.pick.colors, opponent.colors],
    stage: arcade.stage % 6,
    timer: app.settings.timer * 60,
    training: false,
    dummy: 0,
    difficulty: 1 + arcade.stage,
    seed: 1000 + arcade.stage * 77,
    cpu: true,
  };
  const names: [string, string] = [app.settings.name || "PLAYER", `CPU ${arcade.stage + 1}`];

  const match = new MatchScreen({
    cfg,
    names,
    mode: "arcade",
    localTeam: 0,
    onExit: () => {
      arcade.pick = null;
      app.go("home");
    },
    onNextArcade: (won) => {
      if (won) {
        arcade.stage += 1;
      } else {
        arcade.pick = null;
      }
      app.go("arcade");
    },
  });
  match.start();
  return match.element();
}

// -------------------------------------------------------- local versus
let localPick: { p1: TeamPick | null } = { p1: null };
export function resetLocal() {
  localPick = { p1: null };
}

export function localScreen(app: App): HTMLElement {
  if (!localPick.p1) {
    const sel = new CharSelect({
      title: "Local Versus — Player 1 Team",
      subtitle: "Player 1 picks first. Player 2 picks next on the same screen.",
      mode: "versus",
      side: 0,
      onBack: () => app.go("home"),
      onConfirm: (pick) => {
        localPick.p1 = pick;
        app.go("local");
      }
    });
    return sel.element() as HTMLElement;
  }
  const p1 = localPick.p1;
  const sel2 = new CharSelect({
    title: "Local Versus — Player 2 Team",
    subtitle: "Player 2: pick three fighters. Controls: numpad arrows + J K N M U I.",
    mode: "versus",
    side: 1,
    opponentPreview: p1,
    opponentName: "Player 1",
    onBack: () => {
      localPick.p1 = null;
      app.go("local");
    },
    onConfirm: (p2) => {
      const cfg: MatchConfig = {
        teams: [p1.chars, p2.chars],
        assists: [p1.assists, p2.assists],
        colors: [p1.colors, p2.colors],
        stage: app.settings.stage,
        timer: app.settings.timer * 60,
        training: false,
        dummy: 0,
        difficulty: 2,
        seed: 424242,
        cpu: false,
      };
      const match = new MatchScreen({
        cfg,
        names: ["PLAYER 1", "PLAYER 2"],
        mode: "local",
        localTeam: 0,
        onExit: () => {
          localPick.p1 = null;
          app.go("home");
        },
      });
      app.showNode(match.element());
      match.start();
    }
  });
  return sel2.element() as HTMLElement;
}

// ---------------------------------------------------------- training
export function trainingScreen(app: App): HTMLElement {
  const sel = new CharSelect({
    title: "Training — Team Select",
    subtitle: "Infinite meter, frozen timer, dummy AI you can cycle in-match.",
    mode: "solo",
    side: 0,
    onBack: () => app.go("home"),
    onConfirm: (pick) => {
      const mirror: TeamPick = {
        chars: [...pick.chars],
        assists: [...pick.assists],
        colors: pick.colors.map((c) => (c + 2) % COLORS_PER_CHAR),
      };
      const cfg: MatchConfig = {
        teams: [pick.chars, mirror.chars],
        assists: [pick.assists, mirror.assists],
        colors: [pick.colors, mirror.colors],
        stage: 3,
        timer: 99 * 60,
        training: true,
        dummy: 0,
        difficulty: 1,
        seed: 999,
        cpu: false,
      };
      const match = new MatchScreen({
        cfg,
        names: ["YOU", "DUMMY"],
        mode: "training",
        localTeam: 0,
        onExit: () => app.go("training"),
      });
      app.showNode(match.element());
      match.start();
    }
  });
  return sel.element() as HTMLElement;
}

// ------------------------------------------------------------ gallery
export function galleryScreen(app: App): HTMLElement {
  const body = el("div", { class: "gallery-body" });
  const detail = el("aside", { class: "gallery-detail" });
  let colorIdx = 0;
  let selected = 0;

  const showDetail = (idx: number) => {
    selected = idx;
    const def = ROSTER[idx];
    const moves = movesFor(idx);
    detail.replaceChildren();
    detail.append(
      el("div", { class: "detail-top" },
        portrait(def, colorIdx, 132, false),
        el("div", {},
          el("h2", { text: def.name }),
          el("span", { class: `tag ${def.side}`, text: def.side.toUpperCase() }),
          el("span", { class: "tag", text: def.arch.toUpperCase() }),
          el("p", { class: "muted sm", text: def.tagline })
        )
      )
    );
    const sw = el("div", { class: "swatches" });
    for (let c = 0; c < COLORS_PER_CHAR; c++) {
      const col = colorsFor(idx, c);
      sw.append(el("button", {
        class: `swatch ${c === colorIdx ? "on" : ""}`,
        style: { background: hex(col.primary) },
        title: `Colour ${c + 1}`,
        on: { click: () => { colorIdx = c; showDetail(idx); } },
      }));
    }
    detail.append(el("h3", { text: "Colours (all unlocked)" }), sw);

    detail.append(
      el("h3", { text: "Stats" }),
      el("div", { class: "stat-rows" },
        ...[
          ["Health", `${def.hp}`],
          ["Walk forward", def.walkF.toFixed(1)],
          ["Walk back", def.walkB.toFixed(1)],
          ["Jump", def.jump.toFixed(1)],
          ["Projectile", def.proj ? "yes" : "no"]
        ].map(([k, v]) => el("div", { class: "stat-row" }, el("span", { text: k }), el("b", { text: v })))
      )
    );

    detail.append(
      el("h3", { text: "Specials" }),
      el("div", { class: "move-list" },
        ...moves.slice(M.SP1, M.ASSIST).map((mv) =>
          el("div", { class: "move-row" },
            el("b", { text: mv.name }),
            el("span", { text: `${mv.startup}f start · ${mv.hit.dmg} dmg${mv.cost ? ` · ${mv.cost / 100} bar` : ""}` })
          )
        )
      )
    );
  };

  const grid = el("div", { class: "gallery-grid" });
  ROSTER.forEach((def, idx) => {
    const card = el("button", {
      class: "gallery-card",
      on: { click: () => showDetail(idx) },
      title: `${def.name} — ${def.tagline}`,
    }, portrait(def, 0, 72), el("span", { class: "gc-name", text: def.name }));
    grid.append(card);
  });

  body.append(grid, detail);
  showDetail(0);

  return shell(app, "Character Gallery", "All 56 fighters. Every colour slot is available from the start.", body,
    el("span", { class: "pill cyan", text: "56 / 56" }));
}

// ----------------------------------------------------------- settings
export function settingsScreen(app: App): HTMLElement {
  const s = app.settings;
  const body = el("div", { class: "settings-body" });

  const bindKey = (map: KeyMap, which: keyof KeyMap, label: string) => {
    const kbd = el("kbd", { text: keyLabel(map[which]) });
    const btn = button("", "ghost sm", () => {
      kbd.textContent = "press…";
      input.captureNext((code) => {
        map[which] = code;
        kbd.textContent = keyLabel(code);
        app.persist();
      });
    });
    btn.append(icon("pad"));
    return el("div", { class: "bind-row" }, el("span", { text: label }), kbd, btn);
  };

  const playerCol = (map: KeyMap, title: string, note: string) =>
    el("div", { class: "settings-card" },
      el("h3", { text: title }),
      el("p", { class: "muted sm", text: note }),
      ...(Object.keys(ACTION_LABELS) as (keyof KeyMap)[]).map((k) =>
        bindKey(map, k, ACTION_LABELS[k])
      )
    );

  const nameInput = el("input", { class: "input", attrs: { type: "text", maxlength: 16, placeholder: "Your name" } });
  nameInput.value = s.name;
  nameInput.oninput = () => {
    s.name = nameInput.value.slice(0, 16);
    app.persist();
  };

  const signalInput = el("input", { class: "input", attrs: { type: "url", placeholder: "wss://your-signal-host" } });
  signalInput.value = s.signalUrl;
  signalInput.onchange = () => {
    s.signalUrl = signalInput.value.trim();
    app.persist();
    toast("Signal URL saved. Re-open Online to use it.", "ok");
  };

  const stageSel = el("select", { class: "input" });
  for (let i = 0; i < 6; i++) {
    const o = el("option", { text: stageName(i) });
    o.value = String(i);
    stageSel.append(o);
  }
  stageSel.value = String(s.stage);
  stageSel.onchange = () => {
    s.stage = Number(stageSel.value);
    app.persist();
  };

  const timerSel = el("select", { class: "input" });
  for (const t of [60, 99, 180]) {
    const o = el("option", { text: `${t} seconds` });
    o.value = String(t);
    timerSel.append(o);
  }
  timerSel.value = String(s.timer);
  timerSel.onchange = () => {
    s.timer = Number(timerSel.value);
    app.persist();
  };

  body.append(
    el("div", { class: "settings-col" },
      el("div", { class: "settings-card" },
        el("h3", { text: "Profile" }),
        el("label", { class: "field" }, el("span", { text: "Display name" }), nameInput)
      ),
      el("div", { class: "settings-card" },
        el("h3", { text: "Online" }),
        el("p", { class: "muted sm", text:
          "The signaling server pairs browsers and relays WebRTC handshakes. Inputs travel peer-to-peer. " +
          "Leave blank to use this site's own server (or 127.0.0.1:8787 in local development)." }),
        el("label", { class: "field" }, el("span", { text: "Signal server (wss://)" }), signalInput),
        el("p", { class: "muted sm", text: "Debug hint: append ?signal=wss://host to the URL to override for one visit." })
      ),
      el("div", { class: "settings-card" },
        el("h3", { text: "Match rules" }),
        el("label", { class: "field" }, el("span", { text: "Default stage" }), stageSel),
        el("label", { class: "field" }, el("span", { text: "Round timer" }), timerSel),
        el("label", { class: "field" },
          el("span", { text: "Show hitboxes in training" }),
          el("input", {
            attrs: { type: "checkbox" },
            on: {
              change: (ev) => {
                s.showHitboxes = (ev.target as HTMLInputElement).checked;
                app.persist();
              },
            },
          })
        )
      )
    ),
    el("div", { class: "settings-col" },
      playerCol(s.p1, "Player 1 keys", "Used in Arcade, Training and Online."),
      playerCol(s.p2, "Player 2 keys (local versus)", "Second keyboard set on the same machine."),
      el("div", { class: "settings-card" },
        el("h3", { text: "Reset" }),
        el("div", { class: "panel-actions" },
          button("Restore default keys", "ghost", () => {
            s.p1 = { ...P1_KEYS };
            s.p2 = { ...P2_KEYS };
            app.persist();
            app.go("settings");
            toast("Keys restored.", "ok");
          })
        )
      )
    )
  );

  return shell(app, "Settings", "Controls, server and match rules. Everything is stored in this browser.", body);
}

// -------------------------------------------------------------- online
let onlineView: OnlineView | null = null;

export function onlineScreen(app: App): HTMLElement {
  if (!onlineView) {
    onlineView = new OnlineView(app);
  }
  onlineView.attach(app);
  return onlineView.element();
}

export function destroyOnline() {
  onlineView?.destroy();
  onlineView = null;
}

export function copyRoomCode(code: string) {
  void copyText(code).then((ok) => toast(ok ? `Room code ${code} copied.` : `Room code: ${code}`, ok ? "ok" : "info"));
}

export { emptyPick };
