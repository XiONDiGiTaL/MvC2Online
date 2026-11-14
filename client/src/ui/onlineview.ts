// The online flow: landing -> lobby -> team select -> rollback match -> results.

import type { App } from "../app";
import { CharSelect, type TeamPick } from "./charselect";
import { MatchScreen } from "./match";
import { OnlineClient, type RoomData } from "./online";
import { button, copyText, el, icon, toast } from "./dom";
import type { PeerState } from "../net/peer";
import { stageName } from "../game/render";

export class OnlineView {
  private root: HTMLElement;
  private app: App;
  private client: OnlineClient | null = null;
  private select: CharSelect | null = null;
  private match: MatchScreen | null = null;
  private peerState: PeerState = "idle";
  private peerDetail = "";
  private error = "";
  private busy = false;
  private joinCode = "";
  private lastPhase = "";
  private cleanup: (() => void) | null = null;
  private searching = false;
  private statsTimer: number | null = null;

  constructor(app: App) {
    this.app = app;
    this.root = el("div", { class: "screen online-screen" });
    const q = new URLSearchParams(location.search).get("room");
    if (q) this.joinCode = q.toUpperCase().slice(0, 6);
  }

  attach(app: App) {
    this.app = app;
    (window as unknown as { __online?: OnlineView }).__online = this;
    if (!this.root.isConnected) this.render();
  }

  element(): HTMLElement {
    if (!this.root.firstChild) this.render();
    return this.root;
  }

  destroy() {
    this.match?.dispose();
    this.client?.leave();
    this.stopStats();
    this.cleanup?.();
  }

  /** RTT refreshes on a timer so the lobby shows live connection quality. */
  private ensureStats(room: RoomData | null) {
    if (!room || room.phase !== "lobby" || this.client?.peer?.state !== "connected") {
      this.stopStats();
      return;
    }
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setInterval(() => {
      if (!this.client?.room || this.client.room.phase !== "lobby") {
        this.stopStats();
        return;
      }
      this.render();
    }, 1500);
  }

  private stopStats() {
    if (this.statsTimer !== null) window.clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private connectionRow(): HTMLElement | null {
    const peer = this.client?.peer;
    if (!peer || peer.state !== "connected") return null;
    const q = peer.quality();
    const label = q === "unknown" ? "measuring…" : `${peer.rtt} ms · ${q.toUpperCase()}`;
    return el("div", { class: "conn-row" },
      el("span", { class: `dot ${q === "poor" ? "" : "on"}` }),
      el("span", { class: "muted sm", text: `CONNECTION ${label}` }),
      q === "poor" ? el("span", { class: "err sm", text: "High latency — expect rollbacks." }) : null
    );
  }

  // --------------------------------------------------------- rendering
  private render() {
    this.root.replaceChildren();
    const room = this.client?.room ?? null;
    this.ensureStats(room);

    if (this.match && room?.phase === "match") {
      this.root.append(this.match.element());
      return;
    }
    if (!this.client || !room) {
      this.root.append(this.head("Online Multiplayer", "Find an opponent, create a room, or join with a code."));
      this.root.append(this.searching ? this.searchingPanel() : this.landing());
    } else if (room.phase === "select") {
      this.root.append(this.head("Team Select", `Room ${room.code} · both players are picking.`));
      this.root.append(this.selectEl(room));
    } else if (room.phase === "match") {
      this.root.append(this.head("Starting match", "Negotiating the peer connection."));
      this.root.append(el("div", { class: "panel center" },
        el("h2", { text: "LAUNCHING" }),
        el("p", { class: "muted", text: this.peerStatusText() }),
        this.error ? el("p", { class: "err", text: this.error }) : null
      ));
    } else {
      this.root.append(this.head("Lobby", `Room ${room.code}`));
      this.root.append(this.lobby(room));
    }
  }

  private head(title: string, sub: string): HTMLElement {
    return el("header", { class: "screen-head" },
      el("div", { class: "head-left" },
        el("div", {},
          el("h1", { text: title }),
          el("p", { class: "sub", text: sub })
        )
      ),
      el("div", { class: "head-right" },
        el("span", { class: "pill cyan", text: this.peerStatusText() }),
        this.client ? el("span", { class: "pill", text: `${this.client.latency} ms` }) : null
      )
    );
  }

  private peerStatusText(): string {
    switch (this.peerState) {
      case "connected": return "PEER CONNECTED";
      case "connecting": return "CONNECTING…";
      case "failed": return "PEER FAILED";
      case "closed": return "PEER CLOSED";
      default: return "WAITING FOR PEER";
    }
  }

  private searchingPanel(): HTMLElement {
    return el("div", { class: "online-body" },
      el("div", { class: "panel center" },
        el("h2", { text: "SEARCHING FOR AN OPPONENT" }),
        el("p", { class: "muted", text: "You are in the casual queue. The next player who searches is paired with you automatically." }),
        el("div", { class: "conn-row" }, el("span", { class: "dot" }), el("span", { class: "muted sm", text: "QUEUED" })),
        this.error ? el("p", { class: "err", text: this.error }) : null,
        button("Cancel search", "ghost", () => {
          this.searching = false;
          this.client?.cancelQueue();
          this.client = null;
          this.render();
        })
      )
    );
  }

  private landing(): HTMLElement {
    const wrap = el("div", { class: "landing-grid" });

    const nameInput = el("input", { class: "input", attrs: { type: "text", maxlength: 16, placeholder: "Display name" } });
    nameInput.value = this.app.settings.name || "";
    nameInput.oninput = () => {
      this.app.settings.name = nameInput.value.slice(0, 16);
      this.app.persist();
    };

    const codeInput = el("input", {
      class: "input code-input",
      attrs: { type: "text", maxlength: 6, placeholder: "CODE", autocapitalize: "characters" },
    });
    codeInput.value = this.joinCode;
    codeInput.oninput = () => {
      this.joinCode = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
      codeInput.value = this.joinCode;
    };

    const createCard = el("div", { class: "online-card" },
      el("span", { class: "card-kicker", text: "HOST" }),
      el("h2", { text: "Create a room" }),
      el("p", { class: "muted", text: "You get a 4-character code and an invite link. Set the rules, then start when both players are ready." }),
      nameInput,
      button(this.busy ? "Working…" : "Create room", "primary lg", async () => {
        await this.run(async () => {
          this.client = new OnlineClient(this.hooks());
          this.client.name = this.app.settings.name || "Host";
          await this.client.createRoom();
        });
      }, { attrs: { disabled: this.busy } })
    );

    const joinCard = el("div", { class: "online-card" },
      el("span", { class: "card-kicker", text: "GUEST" }),
      el("h2", { text: "Join with a code" }),
      el("p", { class: "muted", text: "Paste the host's code. The invite link fills this in automatically." }),
      codeInput,
      button(this.busy ? "Working…" : "Join room", "lg", async () => {
        if (this.joinCode.length < 4) {
          toast("Enter the 4-character room code.", "error");
          return;
        }
        await this.run(async () => {
          this.client = new OnlineClient(this.hooks());
          this.client.name = this.app.settings.name || "Guest";
          await this.client.joinRoom(this.joinCode);
        });
      }, { attrs: { disabled: this.busy } })
    );

    const quickCard = el("div", { class: "online-card" },
      el("span", { class: "card-kicker", text: "QUICK MATCH" }),
      el("h2", { text: "Find an opponent" }),
      el("p", { class: "muted", text: "Casual match against the next player searching. No code to share — you drop straight into a lobby together." }),
      button(this.busy ? "Working…" : "Find opponent", "primary lg", async () => {
        await this.run(async () => {
          this.client = new OnlineClient(this.hooks());
          this.client.name = this.app.settings.name || "Player";
          this.searching = true;
          await this.client.quickMatch("casual");
        });
      }, { attrs: { disabled: this.busy } })
    );

    wrap.append(createCard, joinCard, quickCard);

    const info = el("div", { class: "online-info" },
      el("h3", { text: "How the connection works" }),
      el("ul", { class: "bullets" },
        el("li", { text: "The signaling server pairs the two browsers and relays the WebRTC handshake." }),
        el("li", { text: "Gameplay inputs go peer-to-peer on an unreliable, unordered data channel — no server round trip, no head-of-line blocking." }),
        el("li", { text: "Both clients run the same deterministic simulation. Late inputs are rolled back and resimulated, so neither player waits for the other." })
      ),
      this.error ? el("p", { class: "err", text: this.error }) : null
    );

    return el("div", { class: "online-body" }, wrap, info);
  }

  private hooks() {
    return {
      onRoom: (room: RoomData) => {
        this.busy = false;
        this.error = "";
        this.searching = false;
        this.syncPhase(room);
      },
      onError: (message: string) => {
        this.busy = false;
        this.searching = false;
        this.error = message;
        toast(message, "error");
        this.render();
      },
      onPeerState: (s: PeerState, detail?: string) => {
        this.peerState = s;
        this.peerDetail = detail ?? "";
        this.render();
      },
      onPhase: (phase: "lobby" | "select" | "match") => {
        const room = this.client?.room;
        if (room) this.syncPhase(room);
        void phase;
      },
    };
  }

  private syncPhase(room: RoomData) {
    if (room.phase !== this.lastPhase) {
      this.lastPhase = room.phase;
      if (room.phase !== "select") this.select = null;
      if (room.phase !== "match") {
        this.match?.dispose();
        this.match = null;
      }
    }
    if (room.phase === "match" && !this.match) {
      this.startMatch(room);
      return;
    }
    this.render();
  }

  // ------------------------------------------------------------ lobby
  private lobby(room: RoomData): HTMLElement {
    const body = el("div", { class: "lobby-grid" });
    const isHost = this.client?.isHost ?? false;
    const hostP = room.host;
    const guestP = room.guest;
    const bothReady = !!hostP?.ready && !!guestP?.ready;

    const codeCard = el("div", { class: "lobby-card code-card" },
      el("span", { class: "card-kicker", text: "ROOM CODE" }),
      el("div", { class: "room-code", text: room.code || "····" }),
      el("div", { class: "code-actions" },
        button("Copy code", "ghost sm", () => {
          void copyText(room.code).then((ok) => toast(ok ? "Code copied." : `Code: ${room.code}`, ok ? "ok" : "info"));
        }),
        button("Copy invite link", "primary sm", () => {
          const link = this.client?.inviteLink() ?? "";
          void copyText(link).then((ok) => toast(ok ? "Invite link copied." : link, ok ? "ok" : "info"));
        })
      ),
      el("input", {
        class: "input link-input",
        attrs: { readonly: true, value: this.client?.inviteLink() ?? "" },
      })
    );

    const seat = (p: { name: string; ready: boolean } | null, role: string, you: boolean) =>
      el("div", { class: `seat ${p ? "filled" : "open"}` },
        el("div", { class: "seat-role", text: role }),
        el("div", { class: "seat-name", text: p ? p.name : "waiting…" }),
        el("div", { class: `seat-ready ${p?.ready ? "on" : ""}`, text: p?.ready ? "READY" : p ? "NOT READY" : "EMPTY" }),
        you ? el("span", { class: "you-badge", text: "YOU" }) : null
      );

    const players = el("div", { class: "lobby-card" },
      el("h2", { text: "Players" }),
      el("div", { class: "seats" },
        seat(hostP, "HOST", isHost),
        seat(guestP, "GUEST", !isHost)
      ),
      el("div", { class: "conn-row" },
        el("span", { class: `dot ${this.peerState === "connected" ? "on" : ""}` }),
        el("span", { class: "muted sm", text: this.peerStatusText() + (this.peerDetail ? ` — ${this.peerDetail}` : "") })
      ),
      this.connectionRow()
    );

    const stageSel = el("select", { class: "input", attrs: { disabled: !isHost } });
    for (let i = 0; i < 6; i++) {
      const o = el("option", { text: stageName(i) });
      o.value = String(i);
      stageSel.append(o);
    }
    stageSel.value = String(room.meta.stage ?? 0);
    stageSel.onchange = () => {
      this.client?.pushRoom({ meta: { stage: Number(stageSel.value) } });
    };

    const timerSel = el("select", { class: "input", attrs: { disabled: !isHost } });
    for (const t of [60, 99, 180]) {
      const o = el("option", { text: `${t} seconds` });
      o.value = String(t);
      timerSel.append(o);
    }
    timerSel.value = String(room.meta.timer ?? 99);
    timerSel.onchange = () => {
      this.client?.pushRoom({ meta: { timer: Number(timerSel.value) } });
    };

    const settings = el("div", { class: "lobby-card" },
      el("h2", { text: "Match settings" }),
      el("label", { class: "field" }, el("span", { text: "Stage" }), stageSel),
      el("label", { class: "field" }, el("span", { text: "Timer" }), timerSel),
      el("p", { class: "muted sm", text: isHost ? "Only the host can change these." : "The host controls these." })
    );

    const myReady = isHost ? !!hostP?.ready : !!guestP?.ready;
    const actions = el("div", { class: "lobby-card actions-card" },
      el("h2", { text: "Match" }),
      el("p", { class: "muted sm", text: bothReady ? "Both players are ready." : "Both players must be ready to start." }),
      el("div", { class: "panel-actions" },
        button(myReady ? "Cancel ready" : "Ready up", myReady ? "ghost" : "primary", () => {
          this.client?.setReady(!myReady);
        }),
        isHost
          ? button("Start match", "primary lg", () => {
              if (!bothReady) {
                toast("Wait for both players to ready up.", "error");
                return;
              }
              if (!this.client?.beginSelect()) toast("Opponent is not in the room yet.", "error");
            }, { attrs: { disabled: !bothReady } })
          : el("span", { class: "muted sm", text: "The host starts the match." }),
        button("Leave room", "ghost", () => {
          this.client?.leave();
          this.client = null;
          this.match = null;
          this.select = null;
          this.lastPhase = "";
          this.render();
          this.app.go("home");
        })
      )
    );

    body.append(codeCard, players, settings, actions);
    return body;
  }

  // ----------------------------------------------------------- select
  private selectEl(room: RoomData): HTMLElement {
    if (!this.select) {
      const isHost = this.client?.isHost ?? false;
      const mine = isHost ? room.meta.picks.host : room.meta.picks.guest;
      this.select = new CharSelect({
        title: "Choose your team",
        subtitle: "Three fighters, an assist type and a colour each. Both players pick at the same time.",
        mode: "online",
        side: isHost ? 0 : 1,
        initial: mine,
        opponentPreview: isHost ? room.meta.picks.guest ?? null : room.meta.picks.host ?? null,
        opponentName: "Opponent",
        lockLabel: "Lock team",
        onBack: () => {
          if (this.client?.isHost) this.client.resetToLobby();
        },
        onConfirm: (pick: TeamPick) => {
          this.client?.submitPick(pick);
          toast("Team locked — waiting for the other player.", "ok");
        },
        onPickChange: (pick) => {
          // Live preview to the host so the other side can see progress. The
          // host's own pick is committed on lock-in, so no room churn here.
          this.client?.previewPick(pick);
        },
      });
    }
    const wrap = el("div", { class: "select-host" },
      this.select.element(),
      el("div", { class: "select-status" },
        el("span", { text: `You: ${(this.client?.isHost ? room.meta.locked.host : room.meta.locked.guest) ? "LOCKED IN" : "picking…"}` }),
        el("span", { text: `Opponent: ${(this.client?.isHost ? room.meta.locked.guest : room.meta.locked.host) ? "LOCKED IN" : "picking…"}` })
      )
    );
    return wrap;
  }

  // ------------------------------------------------------------ match
  private startMatch(room: RoomData) {
    const client = this.client;
    if (!client || !client.peer) {
      this.error = "Peer connection is not ready yet.";
      this.render();
      return;
    }
    if (!client.peer.isOpen) {
      // wait for the channel, then retry once
      window.setTimeout(() => {
        if (this.client?.room?.phase === "match" && !this.match) this.startMatch(room);
      }, 400);
      this.render();
      return;
    }
    const localTeam: 0 | 1 = client.isHost ? 0 : 1;
    const built = client.buildMatch(localTeam);
    if (!built) {
      this.error = "Missing team data for one of the players.";
      this.render();
      return;
    }
    const hostName = room.host?.name ?? "HOST";
    const guestName = room.guest?.name ?? "GUEST";
    const match = new MatchScreen({
      cfg: built.cfg,
      names: localTeam === 0 ? [hostName, guestName] : [hostName, guestName],
      mode: "online",
      localTeam,
      net: { peer: client.peer, session: built.session },
      netLabel: () => this.peerStatusText(),
      onExit: () => {
        this.match?.dispose();
        this.match = null;
        this.select = null;
        if (this.client?.isHost) this.client.resetToLobby();
        this.lastPhase = "lobby";
        this.render();
      },
    });
    this.match = match;
    match.start();
    this.root.replaceChildren(match.element());
  }

  private async run(fn: () => Promise<void>) {
    this.busy = true;
    this.error = "";
    this.render();
    try {
      await fn();
      this.busy = false;
      this.render();
    } catch (err) {
      this.busy = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.render();
      toast(this.error, "error");
    }
  }
}
