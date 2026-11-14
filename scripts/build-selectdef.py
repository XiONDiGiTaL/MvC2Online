#!/usr/bin/env python3
"""Write Ikemen GO's character + stage roster for the MvC2 cabinet.

    python scripts/build-selectdef.py

Reads Ikemen/chars and Ikemen/stages from disk, keeps the 56-fighter MvC2
roster in the same order the web client uses (Marvel 0-27, Capcom 28-55),
and rewrites the [Characters] / [ExtraStages] blocks of data/select.def.
Everything after [Options] is left untouched.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IKEMEN = ROOT / "Ikemen"
SELECT = IKEMEN / "data" / "select.def"

# Roster order, identical to client/src/game/roster.ts. Folder names differ
# for a few fighters; the tuple is (folder, display label for comments).
ROSTER = [
    ("Cable", "Cable"),
    ("Marrow", "Marrow"),
    ("CaptainAmerica", "Captain America"),
    ("Cyclops", "Cyclops"),
    ("Wolverine", "Wolverine"),
    ("BoneClawWolverine", "Wolverine (Bone)"),
    ("Spider-Man", "Spider-Man"),
    ("Hulk", "Hulk"),
    ("IronMan", "Iron Man"),
    ("Iceman", "Iceman"),
    ("WarMachine", "War Machine"),
    ("Gambit", "Gambit"),
    ("Rogue", "Rogue"),
    ("Colossus", "Colossus"),
    ("Psylocke", "Psylocke"),
    ("Storm", "Storm"),
    ("SilverSamurai", "Silver Samurai"),
    ("Sabretooth", "Sabretooth"),
    ("Juggernaut", "Juggernaut"),
    ("Shuma-Gorath", "Shuma-Gorath"),
    ("Spiral", "Spiral"),
    ("Blackheart", "Blackheart"),
    ("Marvel_vs_Capcom_2_Venom_v1", "Venom"),
    ("Sentinel", "Sentinel"),
    ("DoctorDoom", "Doctor Doom"),
    ("OmegaRed", "Omega Red"),
    ("Thanos", "Thanos"),
    ("Magneto", "Magneto"),
    ("RubyHeart", "Ruby Heart"),
    ("Amingo", "Amingo"),
    ("Sonson", "SonSon"),
    ("Ryu", "Ryu"),
    ("Ken", "Ken"),
    ("Chun-Li", "Chun-Li"),
    ("Guile", "Guile"),
    ("Zangief", "Zangief"),
    ("Dhalsim", "Dhalsim"),
    ("Charlie", "Charlie"),
    ("Sakura", "Sakura"),
    ("Dan", "Dan"),
    ("Cammy", "Cammy"),
    ("M.Bison", "M. Bison"),
    ("Akuma", "Akuma"),
    ("Jill", "Jill"),
    ("Jin", "Jin"),
    ("StriderHiryu", "Strider Hiryu"),
    ("Hayato", "Hayato"),
    ("Megaman", "Mega Man"),
    ("Roll", "Roll"),
    ("TronBonne", "Tron Bonne"),
    ("Servbot", "Servbot"),
    ("B.B.Hood", "B.B. Hood"),
    ("Felicia", "Felicia"),
    ("Morrigan", "Morrigan"),
    ("CaptainCommando", "Captain Commando"),
    ("Anakaris", "Anakaris"),
]

# Not on the select grid, but present in chars/ and worth keeping playable.
EXTRAS = [("Abyss", "final boss"), ("Norimaro", "Japanese-only secret"), ("Thor", "bonus")]

# The MvC2 stages that shipped with the cabinet.
STAGES = [
    "stages/XX'MVC2'DESERT'XX.def",
    "stages/XX'MVC2'DESERT'ALT'XX.def",
    "stages/XX'AIRSHIP'XX.def",
    "stages/XX'ARCTIC'XX.def",
    "stages/XX'CLOCK'2'XX.def",
    "stages/XX'SWAMP'XX.def",
    "stages/XX'UNDERGROUND'CAVERN'XX.def",
    "stages/[MVC2]Circus_Carnival.def",
]


def char_ref(folder: str) -> str | None:
    """Ikemen wants `folder` when the def matches it, else `folder/def.def`."""
    path = IKEMEN / "chars" / folder
    if not path.is_dir():
        return None
    defs = sorted(p.name for p in path.iterdir() if p.is_file() and p.suffix.lower() == ".def")
    if not defs:
        # Some packs nest one level (Venom ships as chars/X/Venom1/Venom1.def).
        for sub in sorted(path.iterdir()):
            if sub.is_dir():
                nested = sorted(p.name for p in sub.iterdir() if p.is_file() and p.suffix.lower() == ".def")
                if nested:
                    return f"{folder}/{sub.name}/{nested[0]}"
        return None
    if f"{folder}.def" in defs:
        return folder
    return f"{folder}/{defs[0]}"


def main() -> int:
    if not SELECT.exists():
        print(f"missing {SELECT}")
        return 1

    lines = ["[Characters]",
             " ; MvC2 roster, Marvel 0-27 then Capcom 28-55. Order matches the",
             " ; web client's select grid, so both cabinets show the same rows.",
             ""]
    missing = []
    for index, (folder, label) in enumerate(ROSTER):
        ref = char_ref(folder)
        if not ref:
            missing.append(folder)
            continue
        stage = STAGES[index % len(STAGES)]
        lines.append(f"{ref}, {stage}    ; {index:02d} {label}")

    lines.append("")
    lines.append(" ; Not on the MvC2 grid, kept because the folders are here.")
    for folder, note in EXTRAS:
        ref = char_ref(folder)
        if ref:
            lines.append(f"{ref}, random    ; {note}")
    lines.append("")

    stage_block = ["[ExtraStages]"]
    for stage in STAGES:
        if (IKEMEN / stage).exists():
            stage_block.append(stage)
        else:
            missing.append(stage)
    stage_block.append("")

    text = SELECT.read_text(encoding="utf-8", errors="replace")
    # Normalise newlines so the regex blocks match regardless of CRLF.
    body = text.replace("\r\n", "\n")

    body = re.sub(r"\[Characters\]\n.*?(?=\[ExtraStages\])", "\n".join(lines) + "\n",
                  body, count=1, flags=re.S)
    body = re.sub(r"\[ExtraStages\]\n.*?(?=\[Options\])", "\n".join(stage_block) + "\n",
                  body, count=1, flags=re.S)

    SELECT.write_text(body.replace("\n", "\r\n"), encoding="utf-8")

    print(f"select.def: {len(ROSTER) - len([m for m in missing if '/' not in m])} roster slots, "
          f"{len(stage_block) - 2} stages")
    if missing:
        print("missing: " + ", ".join(missing))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
