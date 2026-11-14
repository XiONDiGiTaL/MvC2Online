#!/usr/bin/env python3
"""Fetch the 56 MvC2 character-select portraits and lay them out in roster order.

    python scripts/fetch-portraits.py

Portraits come from StrategyWiki's Marvel vs. Capcom 2 image set, one file per
fighter, and are written to client/public/portraits/pNN.png where NN is the
roster index (Marvel 0-27, Capcom 28-55) — the same order the sheet uses.
A manifest is regenerated so the renderer stops drawing placeholder busts.
"""

import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "client" / "public" / "portraits"
MANIFEST = ROOT / "client" / "src" / "game" / "portrait-manifest.ts"
API = "https://strategywiki.org/w/api.php"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
TILE = 160

# Roster order, exactly as the select screen reads it.
NAMES = [
    "Cable", "Marrow", "Captain America", "Cyclops",
    "Wolverine", "Wolverine Bone", "Spider-Man", "Hulk",
    "Iron Man", "Iceman", "War Machine", "Gambit",
    "Rogue", "Colossus", "Psylocke", "Storm",
    "Silver Samurai", "Sabretooth", "Juggernaut", "Shuma-Gorath",
    "Spiral", "Blackheart", "Venom", "Sentinel",
    "Doctor Doom", "Omega Red", "Thanos", "Magneto",
    "Ruby Heart", "Amingo", "SonSon", "Ryu",
    "Ken", "Chun-Li", "Guile", "Zangief",
    "Dhalsim", "Charlie", "Sakura", "Dan",
    "Cammy", "M. Bison", "Akuma", "Jill",
    "Jin", "Strider Hiryu", "Hayato", "Mega Man",
    "Roll", "Tron Bonne", "Servbot", "B.B. Hood",
    "Felicia", "Morrigan", "Captain Commando", "Anakaris",
]

# Filenames on the wiki do not always spell names out.
ALIASES = {
    "captainamerica": ["captamerica", "captainamerica", "cap"],
    "wolverinebone": ["wolverinebone", "wolvbone", "bonewolverine"],
    "spiderman": ["spiderman", "spider"],
    "ironman": ["ironman"],
    "warmachine": ["warmachine"],
    "silversamurai": ["silversamurai"],
    "shumagorath": ["shumagorath", "shuma"],
    "doctordoom": ["drdoom", "doctordoom", "doom"],
    "omegared": ["omegared"],
    "rubyheart": ["rubyheart", "ruby"],
    "sonson": ["sonson"],
    "chunli": ["chunli", "chun"],
    "mbison": ["mbison", "bison"],
    "striderhiryu": ["striderhiryu", "strider"],
    "megaman": ["megaman", "megaman"],
    "tronbonne": ["tronbonne", "tron"],
    "bbhood": ["bbhood", "bb"],
    "captaincommando": ["captcommando", "captaincommando"],
    "wolverine": ["wolverineadamantium", "wolverine"],
    "sabretooth": ["sabertooth", "sabretooth"],
    "jill": ["jill", "jillvalentine"],
    "jin": ["jin", "jinsaotome"],
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def api(params: dict) -> dict:
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def list_portrait_files() -> dict[str, str]:
    """normalized name -> File: title"""
    out: dict[str, str] = {}
    data = api({
        "action": "query",
        "list": "categorymembers",
        "cmtitle": "Category:Marvel vs. Capcom 2 images",
        "cmlimit": "500",
        "format": "json",
    })
    for m in data.get("query", {}).get("categorymembers", []):
        title = m["title"]
        if not title.lower().startswith("file:portrait mvc2"):
            continue
        base = re.sub(r"^File:Portrait MVC2\s*", "", title, flags=re.I)
        base = re.sub(r"\.png$", "", base, flags=re.I)
        out[norm(base)] = title
    return out


def image_url(title: str) -> str | None:
    data = api({
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    })
    pages = data.get("query", {}).get("pages", {})
    for p in pages.values():
        info = p.get("imageinfo")
        if info:
            return info[0]["url"]
    return None


def main() -> int:
    files = list_portrait_files()
    print(f"portrait files on the wiki: {len(files)}")
    if len(files) < 40:
        print("could not list the portrait set — the category may have changed")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("p*.png"):
        old.unlink()

    written, missing = [], []
    for index, name in enumerate(NAMES):
        key = norm(name)
        title = files.get(key)
        if not title:
            for alias in ALIASES.get(key, []):
                title = files.get(alias)
                if title:
                    break
        if not title:
            # last resort: unique prefix match
            candidates = [t for k, t in files.items() if k.startswith(key[:6])]
            if len(candidates) == 1:
                title = candidates[0]
        if not title:
            missing.append(name)
            continue

        url = image_url(title)
        if not url:
            missing.append(name)
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                blob = r.read()
            img = Image.open(io.BytesIO(blob)).convert("RGBA")
        except Exception as exc:  # noqa: BLE001
            print(f"  {name}: {exc}")
            missing.append(name)
            continue

        # Square it without squashing the face, then scale up cleanly.
        side = max(img.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
        canvas = canvas.resize((TILE, TILE), Image.LANCZOS)
        canvas.save(OUT_DIR / f"p{index:02d}.png", optimize=True)
        written.append(index)

    manifest = (
        "// Generated by scripts/fetch-portraits.py — do not edit by hand.\n"
        "// Character indexes whose portrait tile is a real MvC2 portrait.\n"
        f"export const SHEET_PORTRAITS: ReadonlySet<number> = new Set({json.dumps(written)});\n"
    )
    MANIFEST.write_text(manifest, encoding="utf-8")

    print(f"wrote {len(written)} portraits to {OUT_DIR}")
    if missing:
        print(f"missing ({len(missing)}): {', '.join(missing)}")
    return 0 if len(written) >= 40 else 1


if __name__ == "__main__":
    sys.exit(main())
