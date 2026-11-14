// Remote Play screen: the host shares the real game running on their PC, the
// viewer plays it from a browser tab with no files of their own.

import type { App } from "../app";
import { RemoteSession, type RemoteState } from "../net/remote";
import { button, copyText, el, toast } from "./dom";

const KEY_TO_BUTTON: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyA: "lp",
  KeyS: "hp",
  KeyZ: "lk",
  KeyX: "hk",
  KeyQ: "a1",
  KeyW: "a2",
};

const INJECT_URL = "http://127.0.0.1:8788";

/** Map a KeyboardEvent.code to the key name the local injector understands. */
function codeToKey(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code;
  if (code.startsWith("Arrow")) return code;
  if (code === "Space" || code === "Enter" || code === "Escape") return code;
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  return null;
}

export class RemoteView {
  private app: App;
  private root: HTMLElement;
  private session: RemoteSession | null = null;
  private mode: "host" | "viewer" = "host";
  private state: RemoteState = "idle";
  private detail = "";
  private error = "";
  private code = "";
  private joinCode = "";
  private injector: "unknown" | "up" | "down" = "unknown";
  private video: HTMLVideoElement | null = null;
  private held = new Set<string>();
  private listeners: (() => void)[] = [];
  private streamed: MediaStream | null = null;

  constructor(app: App) {
    this.app = app;
    this.root = el("div", { class: "screen remote-screen" });
    const q = new URLSearchParams(location.search).get("watch");
    if (q) {
      this.mode = "viewer";
      this.joinCode = q.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    }
  }

  attach(app: App) {
    this.app = app;
    if (!this.root.isConnected) this.render();
    // Tell the host up front whether viewer input can actually reach the game.
    if (this.mode === "host" && this.state === "idle" && this.injector === "unknown") {
      void this.checkInjector();
    }
  }

  element(): HTMLElement {
    if (!this.root.firstChild) this.render();
    return this.root;
  }

  destroy() {
    this.releaseKeys();
    for (const off of this.listeners) off();
    this.listeners = [];
    this.session?.close();
    this.session = null;
    this.streamed = null;
  }

  // ------------------------------------------------------------- rendering
  private render() {
    this.root.replaceChildren();
    this.root.append(this.head(), this.body());
  }

  private head(): HTMLElement {
    const pill = el("span", { class: "pill cyan", text: this.stateLabel() });
    return el("header", { class: "screen-head" },
      el("div", { class: "head-left" },
        el("div", {},
          el("h1", { text: "Remote Play" }),
          el("p", { class: "sub", text: "Run the real game on your PC and play it from her browser. Nothing is uploaded." })
        )
      ),
      el("div", { class: "head-right" }, pill)
    );
  }

  private stateLabel(): string {
    if (this.state === "connected") return "LIVE";
    if (this.state === "connecting") return "CONNECTING…";
    if (this.state === "waiting") return "WAITING FOR VIEWER";
    if (this.state === "failed") return "FAILED";
    return "NOT STARTED";
  }

  private body(): HTMLElement {
    if (this.state === "connected" || (this.mode === "viewer" && this.streamed)) {
      return this.stage();
    }

    const tabs = el("div", { class: "remote-tabs" },
      this.tabButton("host", "I'm running the game"),
      this.tabButton("viewer", "I'm watching")
    );

    const panel = this.mode === "host" ? this.hostPanel() : this.viewerPanel();
    return el("div", { class: "online-body" },
      tabs,
      panel,
      this.error ? el("p", { class: "err", text: this.error }) : null,
      this.help()
    );
  }

  private tabButton(mode: "host" | "viewer", label: string): HTMLElement {
    return el("button", {
      class: `nav-link ${this.mode === mode ? "on" : ""}`,
      text: label,
      on: {
        click: () => {
          this.mode = mode;
          this.error = "";
          this.render();
        },
      },
    });
  }

  private hostPanel(): HTMLElement {
    const nameInput = el("input", {
      class: "input",
      attrs: { type: "text", maxlength: 16, placeholder: "Your name" },
    });
    nameInput.value = this.app.settings.name || "Host";

    const share = button(this.state === "waiting" ? "Sharing…" : "Share my game", "primary lg", () => {
      void this.startHosting(nameInput.value);
    }, { attrs: { disabled: this.state === "waiting" || this.state === "connecting" } });

    const injectorNote = el("div", { class: "conn-row" },
      el("span", { class: `dot ${this.injector === "up" ? "on" : ""}` }),
      el("span", { class: "muted sm", text: this.injectorLabel() })
    );

    return el("div", { class: "online-card" },
      el("span", { class: "card-kicker", text: "HOST" }),
      el("h2", { text: "Stream your game" }),
      el("p", { class: "muted", text: "Start the game on your PC, then share the window. She opens the link, watches live and her pad drives player 2." }),
      nameInput,
      share,
      this.code ? el("div", { class: "code-actions" },
        el("div", { class: "room-code", text: this.code }),
        button("Copy link", "primary sm", () => {
          const url = new URL(window.location.href);
          url.searchParams.set("watch", this.code);
          void copyText(url.toString()).then((ok) => toast(ok ? "Link copied — send it to her." : url.toString(), "ok"));
        })
      ) : null,
      injectorNote,
      el("p", { class: "muted sm", text: "Her buttons reach the game only while the game window has focus on your PC. Start the helper with: node scripts/remote-input.mjs" })
    );
  }

  private injectorLabel(): string {
    if (this.injector === "up") return "INPUT HELPER CONNECTED — her buttons are live";
    if (this.injector === "down") return "INPUT HELPER NOT RUNNING — she can watch, but cannot control";
    return "CHECKING INPUT HELPER…";
  }

  private viewerPanel(): HTMLElement {
    const codeInput = el("input", {
      class: "input code-input",
      attrs: { type: "text", maxlength: 4, placeholder: "CODE", autocapitalize: "characters" },
    });
    codeInput.value = this.joinCode;
    codeInput.oninput = () => {
      this.joinCode = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      codeInput.value = this.joinCode;
    };

    return el("div", { class: "online-card" },
      el("span", { class: "card-kicker", text: "VIEWER" }),
      el("h2", { text: "Watch and play" }),
      el("p", { class: "muted", text: "Enter the code you were sent. Your browser streams the picture and sends your controls back — no downloads." }),
      codeInput,
      button("Watch & play", "primary lg", () => {
        void this.startWatching(codeInput.value);
      })
    );
  }

  private help(): HTMLElement {
    return el("div", { class: "online-info" },
      el("h3", { text: "Controls while watching" }),
      el("ul", { class: "bullets" },
        el("li", { text: "Arrows move, A/S punch, Z/X kick, Q/W assists." }),
        el("li", { text: "Click the picture once so the tab has keyboard focus." }),
        el("li", { text: "Fullscreen with F11 for the arcade feel." })
      )
    );
  }

  private stage(): HTMLElement {
    const video = el("video", {
      attrs: { autoplay: true, playsinline: true, controls: false },
      style: {
        width: "100%",
        maxHeight: "72vh",
        background: "#000",
        borderRadius: "12px",
        outline: "none",
      },
    });
    video.muted = false;
    this.video = video;

    const leave = button("Leave", "ghost", () => {
      this.destroy2();
    });

    const status = el("div", { class: "conn-row" },
      el("span", { class: `dot ${this.state === "connected" ? "on" : ""}` }),
      el("span", { class: "muted sm", text: this.mode === "viewer" ? "STREAMING FROM HOST" : `SHARING — CODE ${this.code}` }),
      el("span", { class: "muted sm", text: this.detail })
    );

    return el("div", { class: "remote-stage" }, status, video, el("div", { class: "panel-actions" }, leave));
  }

  // --------------------------------------------------------------- actions
  private async checkInjector() {
    this.injector = "down";
    try {
      const res = await fetch(`${INJECT_URL}/health`, { cache: "no-store" });
      this.injector = res.ok ? "up" : "down";
    } catch {
      this.injector = "down";
    }
    this.render();
  }

  private async startHosting(name: string) {
    this.error = "";
    this.app.settings.name = name.slice(0, 16);
    this.app.persist();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60 },
        audio: true,
      } as DisplayMediaStreamOptions);
      this.streamed = stream;
      // Sharing the window can be stopped from the browser bar; keep our UI honest.
      for (const t of stream.getVideoTracks()) {
        t.onended = () => {
          toast("Screen share ended.", "error");
          this.destroy2();
        };
      }
      const session = new RemoteSession(true, name, {
        onState: (s, d) => {
          this.state = s;
          this.detail = d ?? "";
          this.render();
        },
        onCode: (code) => {
          this.code = code;
          this.render();
        },
        onStream: () => {
          /* host has no incoming stream */
        },
        onInput: (e) => {
          void this.inject(e.button, e.down);
        },
        onError: (msg) => {
          this.error = msg;
          this.render();
        },
      });
      this.session = session;
      await session.host(stream);
      void this.checkInjector();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Could not start screen sharing.";
      this.render();
    }
  }

  private async startWatching(code: string) {
    this.error = "";
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (clean.length < 4) {
      this.error = "Enter the 4-character code.";
      this.render();
      return;
    }
    const session = new RemoteSession(false, this.app.settings.name || "Player", {
      onState: (s, d) => {
        this.state = s;
        this.detail = d ?? "";
        this.render();
      },
      onCode: (c) => {
        this.code = c;
      },
      onStream: (stream) => {
        this.streamed = stream;
        this.render();
        window.setTimeout(() => this.attachStream(), 0);
      },
      onInput: () => {
        /* viewer sends only */
      },
      onError: (msg) => {
        this.error = msg;
        this.render();
      },
    });
    this.session = session;
    try {
      await session.join(clean);
      this.installKeys();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Could not join that room.";
      this.render();
    }
  }

  private attachStream() {
    if (this.video && this.streamed) {
      this.video.srcObject = this.streamed;
      void this.video.play().catch(() => {
        /* autoplay with audio may need a click; the controls remain usable */
      });
    }
  }

  /** Viewer: forward physical keys as logical buttons. */
  private installKeys() {
    const onDown = (ev: KeyboardEvent) => {
      const b = KEY_TO_BUTTON[ev.code];
      if (!b) return;
      ev.preventDefault();
      if (this.held.has(b)) return;
      this.held.add(b);
      this.session?.sendInput(b, true);
    };
    const onUp = (ev: KeyboardEvent) => {
      const b = KEY_TO_BUTTON[ev.code];
      if (!b) return;
      ev.preventDefault();
      this.held.delete(b);
      this.session?.sendInput(b, false);
    };
    const onBlur = () => this.releaseKeys();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    this.listeners.push(
      () => window.removeEventListener("keydown", onDown),
      () => window.removeEventListener("keyup", onUp),
      () => window.removeEventListener("blur", onBlur)
    );
  }

  private releaseKeys() {
    for (const b of this.held) this.session?.sendInput(b, false);
    this.held.clear();
  }

  /** Host: translate a logical button into the host's player-2 key and inject. */
  private async inject(buttonId: string, down: boolean) {
    const map = this.app.settings.p2 as unknown as Record<string, string>;
    const code = map[buttonId] ?? buttonId;
    const key = codeToKey(code);
    if (!key) return;
    try {
      await fetch(`${INJECT_URL}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, down }),
      });
      if (this.injector !== "up") {
        this.injector = "up";
        this.render();
      }
    } catch {
      if (this.injector !== "down") {
        this.injector = "down";
        this.render();
        toast("Input helper is not running — viewer controls are off.", "error");
      }
    }
  }

  private destroy2() {
    this.destroy();
    this.state = "idle";
    this.code = "";
    this.error = "";
    this.streamed = null;
    this.render();
  }
}
