# Architecture

How MvC2Online is put together, why each choice was made, and where the seams are.

---

## 1. Runtime choice

The target hardware is confirmed from the supplied image: **Hitachi SH-4 (200 MHz) +
PowerVR2 + Yamaha AICA** (see `naomi-investigation.md`). Three paths were on the table.

**Recompilation.** There is no SH-4 → WebAssembly compiler. Building one means writing
and validating a recompiler, then recreating PVR2's deferred-rendering model and AICA
audio with matching timing before any of it is trustworthy. Worse, the game logic in the
image is not cleanly separable: fighter state machines, hit detection and team logic are
interleaved with graphics and sound DMA. The realistic output would be a rewrite that
happened to be *informed* by disassembly — i.e. a reconstruction wearing a recompilation
label. Rejected.

**Emulator in the browser.** Flycast compiled with Emscripten runs in a browser today.
It fails this project's requirements: the user must supply BIOS + ROM (no “just open the
page”), and — decisively — an emulator's frame execution is not bit-deterministic across
machines, so two clients cannot rollback-sync. Streaming video was excluded by the brief.
Kept only as a documented fallback.

**Reconstruction.** A purpose-built engine that reproduces the *rules* and is
deterministic by construction. This is the only option that satisfies “open the page and
play with someone” plus “rollback netcode”, so it is what ships.

The trade-off is honest and stated everywhere: this engine implements MvC2's systems; it
does not reproduce the arcade ROM's per-character frame data, animation or feel
frame-for-frame (§8).

---

## 2. Determinism contract

Everything below the UI assumes:

- **Fixed 60 Hz step.** No `requestAnimationFrame` delta ever reaches the simulation; the
  loop accumulates time and calls `stepGame` a whole number of times (max 6 per frame to
  avoid spiral-of-death).
- **Numbers only.** `SimState` contains numbers, booleans and arrays of those. Snapshots
  are explicit field-by-field copies (`cloneState`), never object references.
- **No randomness outside state.** The only PRNG is xorshift32 stored in `state.rng`, so a
  resimulated frame draws the same numbers.
- **No transcendentals in the sim.** No `Math.sin/cos/exp/pow` or `Date`. IEEE-754
  `+ - * /` are exactly reproducible across engines, so plain doubles are safe; the
  renderer is free to use trigonometry because it never feeds back into state.

`stateHash` (FNV-1a over fighter fields + timer + active slots) is the desync probe.

---

## 3. Netcode

**Transport.** WebRTC `RTCDataChannel` with `{ ordered: false, maxRetransmits: 0 }`.
Deliberately unreliable and unordered: in a fighting game a stale input is worthless and
TCP-style head-of-line blocking turns one lost packet into a latency spike for every
following input. The WebSocket carries only room/membership metadata and the SDP/ICE
handshake.

**Rollback (GGPO-style)**, in `client/src/net/rollback.ts`:

```
each frame f:
  localIn[f] = sample keyboard/gamepad
  remote     = remoteIn[f] ?? lastConfirmedRemote      # predict
  step(state)
  snaps[f]   = cloneState(state);  hashes[f] = stateHash(state)
  send { f, m, b: last 8 inputs }                       # redundancy
on packet with input for frame g <= currentFrame:
  if usedRemote[g] !== received:  resimulate from g
```

- **Prediction** repeats the opponent's last confirmed input — cheap and accurate at the
  scale a fighting game cares about (a few frames).
- **Snapshots** are a 180-frame ring; resimulation replays stored inputs forward.
- **Redundancy**: every input packet carries the last 8 inputs. A single dropped packet
  costs nothing, which the tests prove at ~8% loss.
- **Desync detection** compares checksums only for frames that are *settled* on both
  sides (`f <= frame-2 && f <= lastRemoteFrame`), and the sender reports a frame 20 behind
  the live one. Comparing live frames produces false positives because rollback is still
  allowed to change them.

**Latency handling.** No fixed input delay: the local player never waits for the peer.
`remoteLagFrames` and rollback count are shown in the in-match overlay so the cost is
visible.

**Measured** (`npm run test:netcode`):

| Scenario | Result |
|---|---|
| 0 ms | identical hashes |
| 4 frames latency | identical hashes, 1373 rollbacks total |
| 6 frames latency + ~8% loss | identical at settled frames, 28/28 sampled history frames identical |
| determinism | same inputs twice → same hash |

**Where it would break.** Rollback cost scales with `lag × entity count`; with 6 fighters
plus projectiles this engine resimulates cheaply, but a state twice this size on a low-end
laptop would want a 2–3 frame input delay. That is a knob (`RollbackSession` could accept
a delay offset without changing the design). Real desyncs would come from adding any
non-deterministic element — floating-point `Math` functions, `Object.keys` ordering in the
sim, or `Date.now()` — hence the contract in §2.

---

## 4. Room and matchmaking model

```
browser A ──WS──┐                       ┌──WS── browser B
                ├── signaling server ───┤      (rooms, SDP/ICE relay, ready state)
   │            └───────────────────────┘            │
   └──────── WebRTC data channel (inputs) ───────────┘
```

- The **host is authoritative for room metadata**. Guests send picks over the relay; the
  host merges and rebroadcasts the whole room object. No merge conflicts, no server-side
  game state.
- Phase machine: `lobby → select → match → lobby`. The host advances phases; guests only
  react. A guest leaving keeps the room; a host leaving closes it (and notifies the guest).
- Codes are 4 characters from an unambiguous alphabet, unique per live room, and rooms die
  with their host.
- Invite link is `?room=CODE`; the client prefills the code and prompts for a name.

---

## 5. Simulation layout

`SimState.fighters` is always 6 entries — indices `0..2` team 0, `3..5` team 1, with
`state.active[team]` naming the on-screen slot. Assists are the same fighters temporarily
`onScreen` with `FS.ASSIST`; they take damage but cannot be KO'd (documented engine
simplification).

Frame data is data, not code: `movesFor(charIdx)` builds a flat move table
(`normals → SP1 → SP2 → HYP1 → HYP2 → ASSIST`) once per character and caches it. Hit
resolution walks that table each frame for active frames only.

Systems implemented: chain cancels (light→heavy on hit, normal→special), launchers into
air combos with bounce limits, super jump (down-then-up buffer), command-input buffer
(down+forward for QCF, forward+down for DP, 32-frame charge), throws, pushblock
(`HP+HK` during blockstun), damage scaling (`max(0.18, 1 − 0.11·hits)`), meter gain on
hit/block/damage, chip damage, assist cooldown, tag vulnerability window, hyper flash and
invincibility frames.

---

## 6. Rendering

Canvas 2D at a fixed 1280×720 logical space, camera follows the fighters' midpoint with a
zoom clamped to `0.82–1.12`. Fighters are procedurally drawn (head, torso, limbs, glove)
with per-character palettes generated from a hue seed — this is why all six colour slots
exist without shipping art, and why no copyrighted asset is in the bundle.

HUD: segmented health bars with teammate pips, five-segment hyper meter, 99-second timer,
combo counter with damage, announcements, stage label, and an optional netcode overlay.

---

## 7. File map and coupling

`engine.ts` depends only on `types.ts` and `roster.ts` — no DOM, no network. That is what
lets the netcode tests run headless in Node. `rollback.ts` depends on the engine plus
`SimState`. `peer.ts`/`signal.ts` know nothing about the game. `ui/` is the only layer that
touches the DOM, and it hands the match screen a `MatchConfig` plus, for online, a
`RollbackSession` and an open `RtcPeer`.

---

## 8. Known limitations (deliberate)

1. **Frame data is archetype-derived.** Each of the 56 fighters has its own health, walk
   speed, jump arc, weight, palette, special names and projectile flag, and shares one of
   five archetype frame templates (balanced / rushdown / grappler / zoner / technical).
   Real per-character MvC2 frame data would have to be reconstructed from disassembly;
   nothing here claims to be it.
2. **No animation system.** Poses are procedural and state-driven, not sprite-accurate.
3. **Assist KOs** floor at 1 HP instead of removing the character.
4. **No rollback of "presentation" state** — particles are inside `SimState` for
   determinism, but audio would need to be excluded from the hash if added.
5. **No TURN relay** configured: symmetric NAT will fail to connect. `ICE_SERVERS` in
   `peer.ts` is the single place to add one.
6. **Background tabs pause.** Browser `requestAnimationFrame` throttling means a hidden
   tab stops simulating; this is expected behaviour, not a bug to fix.
7. **Deployment is documented, not performed.** Pages workflow and the Node server exist
   and run locally; nothing is published.

---

## 9. Where to extend

- More characters: add a row to `roster.ts` (the 56-entry assertion will complain if the
  count changes, by design).
- Per-character frame data: replace the archetype template lookup in `movesFor` with a
  real data table; the hit pipeline is already data-driven.
- Input delay: add an offset in `RollbackSession.advance` between sampling and applying the
  local mask.
- Spectating: the signaling server already relays arbitrary payloads; a spectator would be
  a third room seat receiving input packets without sending any.
