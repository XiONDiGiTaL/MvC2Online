// Front-of-house lobby: network status, the mode menu, your profile, the
// friends list and the global chat — the same shape as the arcade cabinets
// people expect, wearing this site's panel system.
//
// Nothing here owns state that must survive a re-render except the chat log and
// friends list, which live at module scope; the live roster comes from the
// LobbyClient and re-renders in place.

import type { App } from "../app";
import { button, el, icon, toast } from "./dom";
import { avatarFromFile, saveProfile } from "./profile";
import { ROSTER } from "../game/roster";
import { portraitUrl } from "../game/render";
import type { LobbyUser } from "../net/lobby";

export interface LobbyAction {
  label: string;
  hint: string;
  icon: string;
  run: () => void;
}

interface Line {
  kind: "chat" | "system";
  name?: string;
  avatar?: string;
  text: string;
  ts: number;
  self?: boolean;
}

const CHAT_KEEP = 120;
const lines: Line[] = [];

interface Friend {
  id: string;
  name: string;
}
const FRIENDS_KEY = "mvc2online.friends.v1";

function loadFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Friend[];
    return Array.isArray(parsed) ? parsed.filter((f) => f && f.id && f.name).slice(0, 100) : [];
  } catch {
    return [];
  }
}

function saveFriends(list: Friend[]) {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* storage full or blocked: list stays for this session */
  }
}

function push(line: Line) {
  lines.push(line);
  if (lines.length > CHAT_KEEP) lines.splice(0, lines.length - CHAT_KEEP);
}

function avatarNode(avatar: string, name: string, size: number): HTMLElement {
  const wrap = el("div", {
    class: "ava",
    style: { width: `${size}px`, height: `${size}px` },
    title: name,
  });
  const portrait = /^@portrait:(\d+)$/.exec(avatar);
  if (portrait) {
    const index = Number(portrait[1]);
    if (ROSTER[index]) {
      wrap.append(el("img", { attrs: { src: portraitUrl(index, 0), alt: "", loading: "lazy" } }));
      return wrap;
    }
  }
  if (avatar.startsWith("data:image")) {
    wrap.append(el("img", { attrs: { src: avatar, alt: "" } }));
    return wrap;
  }
  wrap.classList.add("ava-fallback");
  wrap.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return wrap;
}

function panel(title: string, body: HTMLElement, right?: HTMLElement): HTMLElement {
  return el("section", { class: "lb-panel" },
    el("header", { class: "lb-head" },
      el("h2", { text: title }),
      right ?? el("span", {})
    ),
    body
  );
}

export function homeLobby(app: App, actions: LobbyAction[]): HTMLElement {
  const root = el("div", { class: "lobby" });
  const cleanup: (() => void)[] = [];
  app.onCleanup(() => {
    for (const fn of cleanup) fn();
  });

  // ------------------------------------------------------------- left rail
  const onlineValue = el("strong", { class: "lb-stat-v", text: "—" });
  const matchValue = el("strong", { class: "lb-stat-v", text: "—" });
  const statusDot = el("span", { class: "lb-dot", title: "Lobby connection" });
  const playersBody = el("div", { class: "lb-list" });
  const left = el("div", { class: "lobby-col" },
    panel("Network Status",
      el("div", { class: "lb-stats" },
        el("div", { class: "lb-stat" },
          el("span", { class: "lb-stat-k", text: "Players online" }), onlineValue
        ),
        el("div", { class: "lb-stat" },
          el("span", { class: "lb-stat-k", text: "Open rooms" }), matchValue
        ),
        el("div", { class: "lb-stat" },
          el("span", { class: "lb-stat-k", text: "Lobby" }),
          el("span", { class: "lb-state" }, statusDot, el("span", { class: "lb-state-t", text: "connecting" }))
        )
      ),
      statusDot
    ),
    panel("Players Online",
      playersBody,
      el("span", { class: "lb-count", text: "0" })
    )
  );
  const countEl = left.querySelector(".lb-count") as HTMLElement;

  // ---------------------------------------------------------------- centre
  const menu = el("div", { class: "lb-menu" });
  for (const a of actions) {
    menu.append(
      el("button", { class: "lb-item", on: { click: () => a.run() } },
        el("span", { class: "lb-item-ico" }, icon(a.icon)),
        el("span", { class: "lb-item-txt" },
          el("strong", { text: a.label }),
          el("span", { text: a.hint })
        ),
        el("span", { class: "lb-item-go", text: "›" })
      )
    );
  }
  const centre = el("div", { class: "lobby-col lobby-centre" },
    panel("Main Menu", menu),
    el("p", { class: "lb-note", text:
      "Online play is peer-to-peer: whoever creates the room is the host, and the code is all the other player needs." })
  );

  // ------------------------------------------------------------- right rail
  const avaHost = el("button", { class: "lb-ava-btn", title: "Change your avatar" },
    avatarNode(app.profile.avatar, app.profile.name, 76),
    el("span", { class: "lb-ava-edit", text: "Edit" })
  );
  const nameInput = el("input", {
    class: "lb-name",
    attrs: { value: app.profile.name, maxlength: "24", spellcheck: "false", "aria-label": "Username" },
  }) as HTMLInputElement;
  const onlineTag = el("span", { class: "lb-tag", text: "offline" });

  const portraitGrid = el("div", { class: "lb-portraits", style: "display:none" });
  ROSTER.forEach((char, index) => {
    portraitGrid.append(el("button", {
      class: "lb-portrait" + (app.profile.avatar === `@portrait:${index}` ? " on" : ""),
      title: char.name,
      on: { click: () => setAvatar(`@portrait:${index}`) },
    }, el("img", { attrs: { src: portraitUrl(index, 0), alt: char.name, loading: "lazy" } })));
  });
  const uploadInput = el("input", {
    class: "lb-upload",
    attrs: { type: "file", accept: "image/*" },
  }) as HTMLInputElement;

  function setAvatar(avatar: string) {
    app.profile = saveProfile({ ...app.profile, avatar });
    app.lobby?.setIdentity({ avatar });
    avaHost.replaceChildren(avatarNode(avatar, app.profile.name, 76), el("span", { class: "lb-ava-edit", text: "Edit" }));
    portraitGrid.querySelectorAll(".lb-portrait").forEach((n, i) => {
      n.classList.toggle("on", avatar === `@portrait:${i}`);
    });
  }

  avaHost.addEventListener("click", () => {
    const open = portraitGrid.style.display !== "none";
    portraitGrid.style.display = open ? "none" : "grid";
  });

  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files?.[0];
    uploadInput.value = "";
    if (!file) return;
    void avatarFromFile(file)
      .then((data) => {
        setAvatar(data);
        toast("Avatar updated", "ok");
      })
      .catch((err: Error) => toast(err.message, "error"));
  });

  const commitName = () => {
    const next = nameInput.value.trim().slice(0, 24);
    if (!next || next === app.profile.name) {
      nameInput.value = app.profile.name;
      return;
    }
    app.profile = saveProfile({ ...app.profile, name: next });
    app.lobby?.setIdentity({ name: app.profile.name });
    app.settings.name = app.profile.name;
    app.persist();
    toast(`You are ${app.profile.name}`, "ok");
  };
  nameInput.addEventListener("blur", commitName);
  nameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      (ev.target as HTMLInputElement).blur();
    }
  });

  const profileBody = el("div", { class: "lb-profile" },
    avaHost,
    el("div", { class: "lb-profile-meta" },
      nameInput,
      el("div", { class: "lb-profile-row" }, onlineTag,
        el("button", { class: "lb-mini", text: "Upload", on: { click: () => uploadInput.click() } })
      ),
      uploadInput
    )
  );

  // friends
  const friendsBody = el("div", { class: "lb-list lb-friends" });
  let friends = loadFriends();

  // chat
  const chatLog = el("div", { class: "lb-chat-log", attrs: { "aria-live": "polite" } });
  const chatInput = el("input", {
    class: "lb-chat-input",
    attrs: { placeholder: "Press Enter to talk…", maxlength: "240", "aria-label": "Global chat message" },
  }) as HTMLInputElement;
  const sendBtn = el("button", {
    class: "lb-send",
    title: "Send",
    text: "↵",
    on: { click: () => sendChat() },
  });

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!app.lobby || app.lobby.status !== "online") {
      toast("Not connected to the lobby", "error");
      return;
    }
    if (app.lobby.sendChat(text)) chatInput.value = "";
    else toast("Slow down a moment", "info");
  }
  chatInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      sendChat();
    }
    ev.stopPropagation();
  });

  const chatBody = el("div", { class: "lb-chat" },
    chatLog,
    el("div", { class: "lb-chat-row" }, chatInput, sendBtn)
  );

  const right = el("div", { class: "lobby-col" },
    panel("Your Profile", profileBody),
    panel("Friends", friendsBody, el("span", { class: "lb-count", text: String(friends.length) })),
    panel("Global Chat", chatBody)
  );
  profileBody.append(portraitGrid);

  root.append(left, centre, right);

  // ------------------------------------------------------------ rendering
  let users: LobbyUser[] = [];

  function renderChat() {
    const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 40;
    chatLog.replaceChildren(...lines.map((line) => line.kind === "system"
      ? el("div", { class: "lb-sys", text: line.text })
      : el("div", { class: "lb-msg" + (line.self ? " me" : "") },
          avatarNode(line.avatar ?? "", line.name ?? "?", 26),
          el("div", { class: "lb-msg-body" },
            el("span", { class: "lb-msg-name", text: line.name ?? "Player" }),
            el("span", { class: "lb-msg-text", text: line.text })
          )
        )));
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  }

  function renderUsers() {
    const online = users.filter((u) => !u.self);
    onlineValue.textContent = String(users.length);
    const withRoom = users.filter((u) => u.room && !u.self);
    matchValue.textContent = String(withRoom.length);
    countEl.textContent = String(users.length);
    onlineTag.textContent = app.lobby?.status === "online" ? "online" : "offline";
    onlineTag.classList.toggle("is-on", app.lobby?.status === "online");
    statusDot.dataset.state = app.lobby?.status ?? "offline";
    (left.querySelector(".lb-state-t") as HTMLElement).textContent = app.lobby?.status ?? "offline";

    playersBody.replaceChildren();
    if (!app.lobby) {
      playersBody.append(el("p", { class: "lb-empty", text: "Lobby is not configured on this build." }));
    } else if (!online.length) {
      playersBody.append(el("p", { class: "lb-empty", text: "Nobody else here yet — share the link." }));
    } else {
      for (const u of online) {
        const isFriend = friends.some((f) => f.id === u.id);
        playersBody.append(
          el("div", { class: "lb-user" },
            avatarNode(u.avatar, u.name, 32),
            el("div", { class: "lb-user-meta" },
              el("strong", { text: u.name }),
              el("span", { class: "lb-user-sub", text: u.room ? `Room ${u.room}` : "In the lobby" })
            ),
            u.room
              ? el("button", {
                  class: "lb-mini on",
                  text: "Join",
                  on: { click: () => joinRoom(u.room as string) },
                })
              : null,
            el("button", {
              class: "lb-mini lb-add" + (isFriend ? " on" : ""),
              text: isFriend ? "✓" : "+",
              title: isFriend ? "Remove friend" : "Add friend",
              on: { click: () => toggleFriend(u) },
            })
          )
        );
      }
    }
    renderFriends();
  }

  function renderFriends() {
    friendsBody.replaceChildren();
    if (!friends.length) {
      friendsBody.append(el("p", { class: "lb-empty", text: "Add players with + once they show up." }));
      return;
    }
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const f of friends) {
      const live = byId.get(f.id);
      friendsBody.append(
        el("div", { class: "lb-user" + (live ? "" : " away") },
          avatarNode(live?.avatar ?? "", f.name, 32),
          el("div", { class: "lb-user-meta" },
            el("strong", { text: f.name }),
            el("span", { class: "lb-user-sub", text: live ? (live.room ? `Room ${live.room}` : "Online") : "Offline" })
          ),
          live?.room
            ? el("button", { class: "lb-mini on", text: "Join", on: { click: () => joinRoom(live.room as string) } })
            : null,
          el("button", {
            class: "lb-mini lb-add on",
            text: "✕",
            title: "Remove friend",
            on: { click: () => removeFriend(f.id) },
          })
        )
      );
    }
  }

  function joinRoom(code: string) {
    location.assign(`${import.meta.env.BASE_URL}?room=${encodeURIComponent(code)}`);
  }

  function toggleFriend(u: LobbyUser) {
    const idx = friends.findIndex((f) => f.id === u.id);
    if (idx >= 0) friends.splice(idx, 1);
    else friends.push({ id: u.id, name: u.name });
    saveFriends(friends);
    const counter = right.querySelectorAll(".lb-count")[0] as HTMLElement;
    if (counter) counter.textContent = String(friends.length);
    renderUsers();
  }

  function removeFriend(id: string) {
    friends = friends.filter((f) => f.id !== id);
    saveFriends(friends);
    renderUsers();
  }

  // live subscriptions (cleaned up when the screen unmounts)
  if (app.lobby) {
    cleanup.push(app.lobby.on((e) => {
      if (e.t === "users") {
        users = e.users;
        renderUsers();
      } else if (e.t === "chat") {
        push({ kind: "chat", name: e.name, avatar: e.avatar, text: e.text, ts: e.ts, self: e.id === app.lobby?.selfId });
        renderChat();
      } else if (e.t === "system") {
        push({ kind: "system", text: e.text, ts: Date.now() });
        renderChat();
      } else if (e.t === "status") {
        renderUsers();
        if (e.status === "online") push({ kind: "system", text: "Connected to the global lobby.", ts: Date.now() });
        else if (e.status === "offline") push({ kind: "system", text: "Lobby connection lost — retrying.", ts: Date.now() });
        renderChat();
      }
    }));
    users = [];
    const self = app.lobby.identity;
    users.push({ id: app.lobby.selfId, name: self.name, avatar: self.avatar, room: self.room, self: true });
  }

  if (!lines.length) push({ kind: "system", text: "Welcome to the lobby. Say hello.", ts: Date.now() });
  renderChat();
  renderUsers();

  return root;
}
