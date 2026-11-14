import "./styles.css";
import { loadSettings, saveSettings, type App, type ScreenId } from "./app";
import {
  homeScreen, arcadeScreen, localScreen, trainingScreen, galleryScreen,
  settingsScreen, onlineScreen, destroyOnline, resetLocal,
  remoteScreen, destroyRemote,
} from "./ui/screens";
import { el, icon } from "./ui/dom";
import { loadProfile } from "./ui/profile";
import { bindLobby, LobbyClient, sendLobbyInviteReply, type LobbyUser } from "./net/lobby";
import {
  AUTOJOIN_KEY, clearHeld, clearOutgoing, expireHeld, invitePlayer, onHeld, onOutgoing,
  peekHeld, queueChallenge, resolveOutgoing,
  type HeldChallenge, type OutgoingInvite, type OutgoingState,
} from "./net/invites";
import { input } from "./game/input";
import { installAudioUnlock } from "./game/audio";
import { setSignalOverride } from "./net/signal";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing from index.html");

// Browsers only allow audio after a gesture; this arms the one-shot unlock.
installAudioUnlock();

const settings = loadSettings();
// The profile is the source of truth for the name: it survives reloads, while
// settings only mirror it for the match HUD.
const profile = loadProfile();
settings.name = profile.name;
saveSettings(settings);
setSignalOverride(settings.signalUrl);

const lobby = new LobbyClient();
lobby.setIdentity({ name: profile.name, avatar: profile.avatar });
bindLobby(lobby);
void lobby.connect();
window.addEventListener("pagehide", () => lobby.close());

// Challenges arrive on the lobby channel from whichever screen the player is
// on, so the accepting banner lives at app level rather than in the home UI.
const inviteStack = el("div", { class: "invite-stack" });

function inviteSlot(): HTMLElement {
  if (!inviteStack.isConnected) document.body.append(inviteStack);
  return inviteStack;
}

let inviteCard: HTMLElement | null = null;
/** the challenge currently on screen, so we can answer it even if it goes stale */
let pendingInvite: { from?: string; name: string; code: string } | null = null;

function dismissInvite() {
  inviteCard?.remove();
  inviteCard = null;
  pendingInvite = null;
}

/** Answer a challenge so the other player stops waiting on it. */
function replyTo(inv: { from?: string; code: string }, state: "accepted" | "declined" | "busy") {
  if (inv.from) sendLobbyInviteReply(inv.from, inv.code, state);
}

function showInvite(inv: { from?: string; name: string; code: string }) {
  dismissInvite();

  // A fight in progress wins over a challenge: acknowledge it, tell the sender,
  // and never offer a button that would drop the player out of a match.
  if (lobby.identity.busy) {
    replyTo(inv, "busy");
    const notice = el("div", { class: "invite-card busy" },
      el("span", { class: "invite-kicker", text: "CHALLENGE" }),
      el("strong", { class: "invite-name", text: `${inv.name} wants a match` }),
      el("span", { class: "invite-code", text: "You are in a match — challenge missed" })
    );
    inviteCard = notice;
    inviteSlot().append(notice);
    window.setTimeout(() => {
      if (inviteCard === notice) dismissInvite();
    }, 6000);
    return;
  }
  const card = el("div", { class: "invite-card" },
    el("span", { class: "invite-kicker", text: "CHALLENGE" }),
    el("strong", { class: "invite-name", text: `${inv.name} wants a match` }),
    el("span", { class: "invite-code", text: `ROOM ${inv.code}` }),
    el("div", { class: "invite-actions" },
      el("button", {
        class: "lb-mini on",
        text: "Accept",
        on: {
          click: () => {
            replyTo(inv, "accepted");
            sessionStorage.setItem(AUTOJOIN_KEY, inv.code);
            dismissInvite();
            location.assign(`?room=${encodeURIComponent(inv.code)}`);
          },
        },
      }),
      el("button", {
        class: "lb-mini",
        text: "Decline",
        on: {
          click: () => {
            replyTo(inv, "declined");
            dismissInvite();
          },
        },
      })
    )
  );
  inviteCard = card;
  pendingInvite = inv;
  inviteSlot().append(card);
  window.setTimeout(() => {
    if (inviteCard === card) dismissInvite();
  }, 45_000);
}

/**
 * A match started while their challenge was still on screen: it can no longer
 * be taken, so tell them and leave a note instead of a live Accept button.
 */
function withdrawInvite() {
  const inv = pendingInvite;
  if (!inv) return;
  replyTo(inv, "busy");
  dismissInvite();
  const notice = el("div", { class: "invite-card busy" },
    el("span", { class: "invite-kicker", text: "CHALLENGE" }),
    el("strong", { class: "invite-name", text: `${inv.name} wants a match` }),
    el("span", { class: "invite-code", text: "You are in a match — challenge missed" })
  );
  inviteCard = notice;
  inviteSlot().append(notice);
  window.setTimeout(() => {
    if (inviteCard === notice) dismissInvite();
  }, 6000);
}

// The other half of a challenge: what happened to the one we sent. Without
// this the sender sits on a room wondering whether anyone is coming.
let outgoingCard: HTMLElement | null = null;
let outgoingTimer: number | null = null;

function renderOutgoing(inv: OutgoingInvite | null) {
  outgoingCard?.remove();
  outgoingCard = null;
  if (outgoingTimer !== null) {
    window.clearTimeout(outgoingTimer);
    outgoingTimer = null;
  }
  if (!inv) return;

  const copy: Record<OutgoingState, [string, string]> = {
    waiting: [`Waiting for ${inv.name}…`, `ROOM ${inv.code}`],
    accepted: [`${inv.name} accepted`, `ROOM ${inv.code} — they are joining`],
    declined: [`${inv.name} declined`, "Try someone else"],
    busy: [`${inv.name} is in a match`, "They are mid-match — try again after"],
    expired: [`No answer from ${inv.name}`, "The invite timed out"],
  };
  const [title, sub] = copy[inv.state];
  const card = el("div", { class: `invite-card out ${inv.state}` },
    el("span", { class: "invite-kicker", text: "CHALLENGE SENT" }),
    el("strong", { class: "invite-name", text: title }),
    el("span", { class: "invite-code", text: sub })
  );
  outgoingCard = card;
  inviteSlot().append(card);

  // Results linger just long enough to read; the waiting card stays until it
  // is answered or times out on its own.
  if (inv.state !== "waiting") {
    outgoingTimer = window.setTimeout(() => {
      if (outgoingCard === card) {
        outgoingCard = null;
        card.remove();
        clearOutgoing();
      }
    }, 7000);
  }
}

onOutgoing(renderOutgoing);

let selfWasBusy = lobby.identity.busy;

// A challenge that was turned away by a match, or simply not answered, is held
// rather than thrown away: the card waits, then offers to send it again.
let players: LobbyUser[] = [];
let heldCard: HTMLElement | null = null;
let heldMode = "";
let heldTimer: number | null = null;

function renderHeld() {
  const h = peekHeld();
  const target = h ? players.find((u) => u.id === h.to) : undefined;
  // A match blocked us, so they have to be seen back in the lobby before we
  // offer again — an absent player is unknown, not free.
  const stuck = Date.now() < (h?.readyAt ?? 0) || (h?.needsFree === true && target?.busy === true);
  const mode = !h ? "" : stuck ? "waiting" : "free";

  // Presence events arrive often; only rebuild when the situation changes.
  if (mode === heldMode && (heldCard || !mode)) return;
  heldMode = mode;
  heldCard?.remove();
  heldCard = null;
  if (heldTimer !== null) {
    window.clearTimeout(heldTimer);
    heldTimer = null;
  }
  if (!h || !mode) return;

  if (mode === "waiting") {
    const card = el("div", { class: "invite-card held" },
      el("span", { class: "invite-kicker", text: "CHALLENGE HELD" }),
      el("strong", { class: "invite-name", text: `Holding one for ${h.name}` }),
      el("span", {
        class: "invite-code",
        text: target?.busy === true
          ? "They are in a match — we will offer it again"
          : "We will offer it again shortly",
      }),
      el("div", { class: "invite-actions" },
        el("button", { class: "lb-mini", text: "Forget it", on: { click: () => clearHeld() } })
      )
    );
    heldCard = card;
    inviteSlot().append(card);
    heldTimer = window.setTimeout(renderHeld, Math.max(0, h.readyAt - Date.now()) + 80);
    return;
  }

  const card = el("div", { class: "invite-card held free" },
    el("span", { class: "invite-kicker", text: "CHALLENGE HELD" }),
    el("strong", { class: "invite-name", text: `${h.name} is free` }),
    el("span", { class: "invite-code", text: "Send the challenge again?" }),
    el("div", { class: "invite-actions" },
      el("button", { class: "lb-mini on", text: "Send", on: { click: () => sendHeld(h) } }),
      el("button", { class: "lb-mini", text: "Not now", on: { click: () => clearHeld() } })
    )
  );
  heldCard = card;
  inviteSlot().append(card);
  heldTimer = window.setTimeout(expireHeld, Math.max(0, h.expiresAt - Date.now()) + 80);
}

function sendHeld(h: HeldChallenge) {
  clearHeld();
  const room = lobby.identity.room;
  if (room && invitePlayer(h.to, h.name, room)) return;
  // No room of our own yet: open one, and the invite follows the code.
  queueChallenge({ id: h.to, name: h.name });
  go("online");
}

onHeld(() => renderHeld());

lobby.on((e) => {
  if (e.t === "invite") showInvite(e);
  else if (e.t === "invite-reply") resolveOutgoing(e.state, e.from);
  else if (e.t === "users") {
    players = e.users;
    renderHeld();
    // If we started a match while a challenge was up, it has to be withdrawn.
    const busyNow = e.users.find((u) => u.self)?.busy === true;
    if (busyNow && !selfWasBusy) withdrawInvite();
    selfWasBusy = busyNow;
  }
});

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
  el("span", { text: "MvC2Online — a fan-made browser engine built around Marvel vs. Capcom 2's rules. Marvel vs. Capcom 2, its characters and their likenesses belong to Capcom and Marvel." }),
  el("a", { text: "xiondigital.net", attrs: { href: "https://xiondigital.net/", target: "_blank", rel: "noopener" } })
);

root.append(nav, view, footer);

const cleanups: (() => void)[] = [];

function runCleanups() {
  while (cleanups.length) {
    const fn = cleanups.pop();
    try {
      fn?.();
    } catch (err) {
      console.error("[mvc2online] screen cleanup threw", err);
    }
  }
}

const app: App = {
  root: view,
  settings,
  profile,
  lobby,
  history: [],
  onCleanup(fn) {
    cleanups.push(fn);
  },
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
  runCleanups();
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
