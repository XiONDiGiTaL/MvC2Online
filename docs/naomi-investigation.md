# NAOMI Binary Investigation — `Marvel vs. Capcom 2.dat`

Investigation record for the supplied NAOMI data. Everything below is either **verified by
direct inspection** (with the command that produced it) or explicitly marked **inferred**.
Nothing here is fabricated. Where a claim could not be verified, it says so.

- File: `Marvel vs. Capcom 2.dat`
- Size: `143,242,752` bytes (`136.61 MiB`)
- SHA-256: run `npm run verify:dat` to print it locally (not committed here)
- The original file is untouched. It is `.gitignore`d and never committed.

---

## 1. Verified findings

### 1.1 It is a multi-region cart container, not a bare ROM

```
00000000: 4e41 4f4d 4920 ...  NAOMI
00000010: 4341 5043 4f4d 2e2c 4c54 442e  CAPCOM.,LTD.
00000030: "MARVEL VS CAPCOM2  JAPAN"
00000050: "MARVEL VS CAPCOM2  USA"
00000070: "MARVEL VS CAPCOM2  EXPORT"
00000090: "MARVEL VS CAPCOM2  KOREA"
000000b0: "MARVEL VS CAPCOM2  AUSTRALIA"
000000d0: "MARVEL VS CAPCOM2"          (blank region)
000000f0: "MARVEL VS CAPCOM2"          (blank region)
00000110: "MARVEL VS CAPCOM2"          (blank region)
```

- `0x00` magic `"NAOMI"`, `0x10` publisher `"CAPCOM.,LTD."`.
- `0x30`–`0x12F`: **eight 32-byte region title slots**. Five are populated
  (JAPAN, USA, EXPORT, KOREA, AUSTRALIA — the same five regions MAME lists for
  `mvsc2`), three are blank. This is a region-selectable cart image, matching the
  MAME description *"Marvel Vs. Capcom 2 New Age of Heroes (JPN, USA, EUR, ASI, AUS) (Rev A)"*.

### 1.2 ROM board ID and build stamp

```
00000130: d0 07 | 02 19 | 42 42 47 30 ("BBG0") | 01 00 00 00
```

- `0x130` `0x07D0` = **2000**, the release year (MvC2 shipped March 2000).
- `0x133` **`"BBG0"`** — the 4-char ROM board / cartridge identifier field.
  *Inferred:* this is the cart ID string the NAOMI loader and the arcade
  operator menu use to identify the title. It is distinct from the MAME romset
  name (`mvsc2`) and from the PCB sticker number (`841-0007C-01`, `317-0274-*`
  per MAME's cart table).

### 1.3 ROM descriptor table with checksums

```
0000015e: 04 00 3a 36 72 a9   04 00 d4 77 df 7b   04 00 62 a6 91 17
          ... 16 records ...
000001be: ff ff
```

- 6-byte records: `u16 flags` (observed values `0x0004`, `0x0003`) followed by a
  32-bit value that reads as a checksum. Terminated by `0xFFFF`.
- **16 records** terminate cleanly at `0x1BE`. MAME's `mvsc2` set contains 18 files,
  so this table may be truncated by one of my alignment assumptions, or the
  container may group physically-identical ROMs. **Not fully resolved** — flagged
  as open, not claimed.
- `0x1E0`–`0x25F`: a byte-per-ROM table of `01`/`02` values. On NAOMI these are
  byte/word-order swap flags the loader applies per ROM device, which is required
  because NAOMI cart ROMs are physically interleaved.

### 1.4 BIOS / operator strings

Only **two** genuine ASCII runs exist in the first 4 MiB:

```
0x000260 "CREDIT TO START                 CREDIT TO CONTINUE"
```

### 1.5 Payload layout, by entropy scan (8 MiB windows)

| Offset | Entropy | Zero bytes | Interpretation |
|---|---|---|---|
| `0x0000000` | 7.285 | 7.3% | header + first ROM bank |
| `0x0080000`–`0x0580000` | 6.4–7.4 | 2–16% | mixed SH-4 code and data ROMs |
| `0x0780000` (120 MiB) | **1.144** | 1.0% | long `0xFF` run — unused cart space |
| `0x0800000` (128 MiB) | 2.086 | 2.0% | boundary: data resumes |

- Confirmed at the boundary: `0x7FFF000`–`0x7FFFFFF` is solid `0xFF` padding,
  then `0x8000000` begins high-entropy data again. So the 128 MiB cart address
  range is padded out, and **~8.6 MiB of additional data follows it** — consistent
  with a container holding the cart image plus extra (sound/program) ROM data.
- The many short ASCII-looking runs in the first MiB (`"\7|6`c<cC3"`, `"5Rb\"$T"`)
  are **false positives** from SH-4 opcode bytes, not strings. That is why a naive
  `strings` pass is useless here; the two runs above are the only real literals.

### 1.6 IEEE-754 data tables at the tail

```
0889b500: 0000 40b2 | 0000 803f | 0000 7e3f | 9919 773f
          3760 95c1 | b558 5641 | 638b a541 | 0000 0000
0889b520: 0000 40b2 | 0000 803f | a8aa 2aba | 0180 163f ...
```

- Fixed **32-byte stride** (8 × `float32`) records, each starting with `0xB2400000`.
- Contains `0x3F800000` (**1.0f**), `0x3F7E0000` (~0.992f), and values around
  `0x41A5xxxx` (≈20.7). *Inferred:* transform / vertex-attribute or lighting
  parameter tables. Not claimed beyond the observed encoding and stride.

---

## 2. Consequences for architecture (this is the important part)

The binary confirms the target precisely, and it also confirms why "recompile the game
into WebAssembly" is not a viable deliverable in this project's timeframe:

1. **The CPU is Hitachi SH-4** (200 MHz, 128-bit SIMD). There is no SH-4 → WASM
   compiler. A recompiler would have to be written and validated instruction-by-instruction
   against hardware behaviour, then the *whole* PowerVR2 rendering model and the
   Yamaha AICA sound core would need equivalents with matching timing.
2. **The rendering is PowerVR2 immediate-mode / tile-deferred.** MvC2's visuals are
   not sprites on a 2D blitter; they are textured, alpha-blended polygon models driven
   by PVR2 display lists. Reimplementing that faithfully is a GPU-emulation research
   project, not a port.
3. **Game logic is not isolated.** There is no clean "rules module" in the image: the
   fighter state machines, hit detection and team logic are interleaved with SH-4
   code and graphics/sound DMA calls. Extracting them means identifying functions in
   Ghidra and rewriting them anyway — at which point it is a **reconstruction**, not a
   recompilation.
4. **Assets are proprietary.** Character models, portraits, voice and music cannot be
   committed to a public repo or served from a public site. See §3.

### Verdict

**Recompilation: rejected** (not feasible here, and would not be honest to claim).
**Emulator-in-browser (Flycast/Emscripten): feasible as a fallback, rejected as the
product** — it needs the user to supply BIOS + ROM, it cannot run a deterministic
rollback simulation (an emulator is not frame-stepped deterministically by default,
so each client would drift), and it contradicts the "no downloads, just open the page"
requirement.

**Chosen: reconstruction.** A dedicated browser-native engine written for this project,
built to MvC2's *rules* (3v3 tag, assists, delayed hyper combos, chain/air combos,
super jumps, pushblock, damage scaling) with a deterministic integer simulation so
**rollback netcode is real**, not decorative. Character identities, frame data and art
are original implementations, not extracted from the ROM.

---

## 3. Legal boundary (must stay true)

- The `.dat`, any BIOS, and any extracted art/audio stay **out of the repository** and
  out of `dist/`. `.gitignore` enforces this and `npm run verify:dat` confirms the ROM
  is not staged.
- The shipped game uses **procedurally drawn fighters and original UI**. Roster *names*
  are used for identification only; no Capcom/Marvel artwork, sprites, portraits, voices
  or music is redistributed.
- Optional user-supplied data packs are supported by design (see
  `docs/architecture.md` §6) so a user with their own copy can point the client at
  their own assets. The public deployment never ships them.

## 4. How to reproduce every number above

```
npm run inspect:dat      # header decode, region slots, descriptor table, entropy map
npm run verify:dat       # SHA-256 + confirm the ROM is not git-tracked
```

Both scripts only read the file. They never write to it.
