# MvC2Online

A **browser-native 3v3 tag fighting game** built around Marvel vs. Capcom 2's rules,
with real rollback netcode, room codes and invite links. Two people open the page in
two browsers, join the same room, pick three fighters each, and play.

- **Live (frontend deployed):** https://xiondigital.net/MvC2Online
- **Repo:** https://github.com/XiONDiGiTaL/MvC2Online
- **Online play:** needs the signaling server hosted — see §Deploy. Until then the live
  URL supports Arcade, Local Versus, Training and the Gallery.

---

## What this is, precisely

This is **not** the NAOMI ROM running in an emulator, and it is **not** a recompiled
port of the arcade binary. It is an original engine written for this project, built to
MvC2's *rules* (3v3 tag, assists, delayed hyper combos, chain and air combos, super
jumps, pushblock, damage scaling, 99-second timer) with a deterministic 60 Hz simulation
so that rollback netcode is genuinely possible.

That choice is documented, with evidence from the actual game file, in
[`docs/naomi-investigation.md`](docs/naomi-investigation.md). Summary:

| Approach | Verdict |
|---|---|
| Recompile NAOMI SH-4 + PowerVR2 game logic to WebAssembly | **Rejected.** No SH-4 → WASM compiler exists; game logic is interleaved with graphics/DMA code and would have to be rewritten anyway. |
| Run an emulator (Flycast/Emscripten) in the browser | **Rejected as the product.** Needs user-supplied BIOS + ROM, and an emulator cannot be frame-stepped deterministically enough for rollback across two clients. Kept as a documented fallback only. |
| Reconstruct the rules in a purpose-built browser engine | **Chosen.** Deterministic, no downloads, rollback-capable, legally clean. |

No Capcom or Marvel artwork, sprites, portraits, audio, music or extracted frame data
is distributed. Fighters are drawn procedurally from per-character palettes; the roster
*names* are used for identification only. The supplied `.dat` is `.gitignore`d and never
committed — `npm run verify:dat` enforces that.

---

## Status

| Area | State | Evidence |
|---|---|---|
| Deterministic 60 Hz simulation | **Implemented** | `npm run test:netcode` → deterministic resimulation hash match |
| Rollback netcode | **Implemented** | 4-frame and 6-frame latency runs converge; 28/28 sampled frames identical with ~8% packet loss |
| Room create / join / invite link | **Implemented** | Verified in two live browser sessions |
| WebRTC peer transport | **Implemented** | Two tabs reached `PEER CONNECTED` and ran a match |
| Independent per-browser inputs | **Implemented** | Each client feeds only its own mask; host=team 0, guest=team 1 |
| 56 characters, 6 colours each | **Implemented** | Roster gated by an assertion at module load |
| 3v3 teams, assists, tag, hypers, launchers, air combos, chains, pushblock, super jump, throws, scaling | **Implemented** | Engine + verified damage/meter/combo checks |
| Arcade (6 stages), Local Versus, Training, Gallery, Settings | **Implemented** | Playable in the browser |
| Key remapping, gamepad support | **Implemented** | Settings screen |
| Per-character frame data matching the arcade ROM | **Not implemented** | Characters share archetype frame templates with per-character stats and names. This is a deliberate, documented limit — see `docs/architecture.md` §8 |
| Original character art / voices / music | **Not implemented** | Legal restriction; procedural visuals instead |
| Matchmaking / ranked / spectating / replays | **Not implemented** | Direct room codes only |
| Frontend deployment | **Deployed & verified** | https://xiondigital.net/MvC2Online/ served by GitHub Pages (200 HTML + JS, 56-card gallery, no console errors) |
| Multiplayer backend deployment | **Not deployed** | The room server runs locally; a public Node host (e.g. Railway) is still needed for online play on the live URL. See §Deploy |
| True recompilation of the NAOMI binary | **Blocked** | Technical + legal; see investigation doc |

Known limitation worth stating plainly: two *background* tabs will not simulate, because
Chrome and Firefox pause `requestAnimationFrame` in hidden tabs. Play in visible windows.

---

## Quick start

```bash
npm install

# terminal 1 — signaling/relay server
npm run server            # http://127.0.0.1:8787  (health at /health)

# terminal 2 — client
npm run dev               # http://127.0.0.1:5173/MvC2Online/
```

Open the page in **two browser windows** (or two profiles), then: *Online Multiplayer →
Create room* in one, and paste the code (or open the copied invite link) in the other.
Both hit **Ready up**, the host hits **Start match**, both lock a team, and the match
begins on a peer-to-peer WebRTC channel.

Other commands:

```bash
npm run build             # typecheck + production build into dist/
npm run preview           # serve the built client
npm run typecheck
npm run test:netcode      # headless rollback/determinism verification
npm run inspect:dat       # read-only NAOMI container analysis
npm run verify:dat        # SHA-256 + confirm ROM is not tracked/shipped
```

---

## Controls

| Input | Action |
|---|---|
| `A` / `S` | Light Punch / Heavy Punch |
| `Z` / `X` | Light Kick / Heavy Kick |
| `Q` / `W` | Assist 1 / Assist 2 |
| Arrows | Move, jump, crouch |

| Command | Action |
|---|---|
| `↓ ↘ → + P` | Special 1 (projectile / rush / command grab by archetype) |
| `→ ↓ ↘ + P` | Special 2 (anti-air) |
| Hold `←` then `→ + P` | Charge special |
| `↓ ↘ → + LP+HP` | Hyper Combo (1 bar) |
| `↓ ↙ ← + LK+HK` | Hyper Combo EX (2 bars) |
| `LP + LK` | Tag out |
| Crouch `HP` | Launcher → jump to continue in the air |
| Block + `HP+HK` | Pushblock |
| `↓` then `↑` | Super jump |

Local versus gives player 2 their own key set (numpad directions + `J K N M U I`), all
remappable in Settings. A connected gamepad is folded into either player's input.

---

## Deploy

### Frontend — GitHub Pages

`.github/workflows/deploy-pages.yml` builds the client with `BASE_PATH=/MvC2Online/`
and publishes `dist/`. In the repo: **Settings → Pages → Source: GitHub Actions**.
Then the site is served at `https://<user>.github.io/MvC2Online/`, and with the
`xiondigital.net` custom domain already attached, at `https://xiondigital.net/MvC2Online`.

### Signaling backend — Railway (or any Node host)

GitHub Pages is static and cannot host signaling, so the room server runs separately:

1. New Railway project from this repo.
2. Start command: `npm start` (runs `server/index.mjs`). `PORT` is injected automatically.
3. Health check path: `/health`.
4. Copy the public host, e.g. `mvc2online-signal.up.railway.app`.

The server also serves `dist/` if present, so it can host the whole app on one origin
(handy for a single-service setup).

### Pointing the client at the backend

Three ways, in priority order:

1. `?signal=wss://host` query parameter (one-off override),
2. **Settings → Signal server** (stored in `localStorage`),
3. `client/public/config.json` → `{ "signalUrl": "wss://host" }` (baked into the build).

Same-origin hosting needs no configuration at all.

### What is actually live right now

The **frontend is deployed** at https://xiondigital.net/MvC2Online/ (GitHub Pages,
`build_type: workflow`, run green) and was checked in a browser: the app mounts, the
dark theme applies, all six nav destinations render, the gallery lists all 56 fighters
with 6 colour slots, and the console is clean.

**Online play from that URL does not work yet**, because the signaling server is not
hosted. Until it is, the Online screen fails with a clear “Could not reach the signaling
server” error instead of pretending to connect. Hosting it is the one remaining step;
afterwards set the endpoint in `client/public/config.json` (or **Settings → Signal
server**) and redeploy.

Local play (Arcade, Local Versus, Training, Gallery) works on the live URL today.

### Verification before claiming a deploy

```bash
npm run build && npm run verify:dat
# then: open the deployed URL in two browsers and confirm room join + a match.
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| “Could not reach the signaling server” | `npm run server`, or set the signal URL in Settings. On Pages you must point at your Railway host. |
| `PEER FAILED` | Restrictive NAT/firewall. The app uses public STUN only; symmetric NAT needs a TURN relay — add one to `ICE_SERVERS` in `client/src/net/peer.ts`. |
| Room code “not found” | Codes are case-insensitive but expire when the host leaves; only the host keeps the room alive. |
| One browser freezes mid-match | That tab is hidden/backgrounded; browsers pause `requestAnimationFrame`. Bring it to the foreground. |
| “Desync detected” | The two clients disagreed on a settled frame checksum. Report it with the frame number from the in-match overlay. |
| Game keys scroll the page | Focus the game canvas; mapped keys are `preventDefault`ed while a match is active. |
| `npm install` warns about blocked esbuild scripts | Approve them (`npm install-scripts approve esbuild`) or reinstall with scripts enabled; Vite needs the esbuild binary. |

---

## Repository map

```
client/                 Vite + TypeScript browser client (no UI framework)
  src/game/engine.ts    deterministic 60 Hz simulation (the rules)
  src/game/render.ts    canvas renderer + HUD
  src/game/roster.ts    56 fighters, palettes, colour slots
  src/game/input.ts     keyboard/gamepad, remapping
  src/net/rollback.ts   rollback session (snapshots, prediction, resim, desync check)
  src/net/peer.ts       WebRTC data channel
  src/net/signal.ts     signaling client
  src/ui/               screens, lobby, team select, match shell
server/index.mjs        room signaling + WebRTC relay + optional static hosting
scripts/                NAOMI inspection + ROM guard rail
tests/netcode.test.ts   headless netcode verification
docs/                   investigation record + architecture
```

## Legal

Marvel vs. Capcom 2 is © Capcom / Marvel. This project ships no game data, no BIOS and
no extracted assets. The supplied NAOMI image stays local and untracked. If you own the
arcade data, keep it that way — the public deployment is an original engine, not a
redistribution.
