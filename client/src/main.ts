import "./styles.css";
import { loadSettings, saveSettings, type App, type ScreenId } from "./app";
import {
  homeScreen, arcadeScreen, localScreen, trainingScreen, galleryScreen,
  settingsScreen, onlineScreen, destroyOnline, resetLocal,
  remoteScreen, destroyRemote,
} from "./ui/screens";
import { el, icon } from "./ui/dom";
import { input } from "./game/input";
import { installAudioUnlock } from "./game/audio";
import { setSignalOverride } from "./net/signal";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing from index.html");

// Browsers only allow audio after a gesture; this arms the one-shot unlock.
installAudioUnlock();

const settings = loadSettings();
if (!settings.name) {
  settings.name = "Player" + String(Math.floor(Math.random() * 900) + 100);
}
saveSettings(settings);
setSignalOverride(settings.signalUrl);

const NAV: [ScreenId, string][] = [
  ["arcade", "Arcade"],
  ["online", "Online Multiplayer"],
  ["remote", "Remote Play"],
  ["local", "Local Versus"],
  ["training", "Training"],
  ["gallery", "Character Gallery"],
  ["settings", "Settings"],
];

let current: ScreenId = "home";

const view = el("main", { id: "view", class: "view" });

const navItems = new Map<ScreenId, HTMLElement>();
const nav = el("nav", { class: "nav" });
const navLinks = el("div", { class: "nav-links" });
const netPill = el("span", { class: "nav-pill", title: "Signaling endpoint" });

const brand = el("button", {
  class: "brand",
  on: { click: () => go("home") },
},
  el("span", { class: "brand-mark", text: "XIØN" }),
  el("span", { class: "brand-div" }),
  el("span", { class: "brand-name", text: "MvC2Online" })
);

for (const [id, label] of NAV) {
  const b = el("button", { class: "nav-link", text: label, on: { click: () => go(id) } });
  b.dataset.nav = id;
  navItems.set(id, b);
  navLinks.append(b);
}
nav.append(brand, navLinks, netPill);

const footer = el("footer", { class: "site-foot" },
  el("span", { text: "MvC2Online — an original browser engine built around Marvel vs. Capcom 2's rules. No Capcom or Marvel assets are distributed." }),
  el("a", { text: "xiondigital.net", attrs: { href: "https://xiondigital.net/", target: "_blank", rel: "noopener" } })
);

root.append(nav, view, footer);

const app: App = {
  root: view,
  settings,
  history: [],
  persist() {
    saveSettings(settings);
    setSignalOverride(settings.signalUrl);
    updateNetPill();
  },
  go,
  back,
  showNode(node: HTMLElement) {
    view.replaceChildren(node);
    document.body.classList.add("in-match");
  },
};

function go(screen: ScreenId, params?: Record<string, unknown>) {
  void params;
  if (screen !== "online") destroyOnline();
  if (screen !== "remote") destroyRemote();
  if (screen === "local") resetLocal();
  current = screen;
  mount(screen);
}

function back() {
  go("home");
}

function updateNetPill() {
  const url = settings.signalUrl;
  netPill.textContent = url ? "SIGNAL · CUSTOM" : "SIGNAL · DEFAULT";
  netPill.title = url || "Auto-resolved: same origin, or ws://127.0.0.1:8787 in local dev";
}

function mount(screen: ScreenId) {
  input.enabled = false;
  input.onEscape = null;
  document.body.classList.remove("in-match");
  for (const [id, node] of navItems) node.classList.toggle("on", id === screen);
  void current;

  let node: HTMLElement;
  switch (screen) {
    case "arcade": node = arcadeScreen(app); break;
    case "online": node = onlineScreen(app); break;
    case "remote": node = remoteScreen(app); break;
    case "local": node = localScreen(app); break;
    case "training": node = trainingScreen(app); break;
    case "gallery": node = galleryScreen(app); break;
    case "settings": node = settingsScreen(app); break;
    default: node = homeScreen(app); break;
  }
  view.replaceChildren(node);
  if (!document.body.classList.contains("in-match")) window.scrollTo({ top: 0 });
}

input.attach();
updateNetPill();

// Deep links: ?room=CODE opens the online screen with the code prefilled.
const roomParam = new URLSearchParams(location.search).get("room");
  const watchParam = new URLSearchParams(location.search).get("watch");
  mount(watchParam ? "remote" : roomParam ? "online" : "home");
if (roomParam) {
  view.prepend(
    el("div", { class: "deeplink-note" },
      icon("link"),
      `Invite detected: room ${roomParam.toUpperCase()}. Enter your name and hit Join.`
    )
  );
}

window.addEventListener("unhandledrejection", (ev) => {
  console.error("[mvc2online] unhandled rejection", ev.reason);
});
