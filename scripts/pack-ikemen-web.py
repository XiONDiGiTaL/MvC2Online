#!/usr/bin/env python3
"""Package the local Ikemen cabinet into fiiight's browser content zip.

    python scripts/pack-ikemen-web.py

Writes tools/fiiight/web/content.zip with this repo's Ikemen data, characters
and stages, laid out exactly as the engine expects at runtime (data/,
chars/, stages/, sound/, font/, external/). fiiight mounts that zip as the
engine's filesystem, so the roster in data/select.def is what the browser
build shows.
"""

import os
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Ikemen"
OUT = ROOT / "tools" / "fiiight" / "web" / "content.zip"

# Directories the browser build needs. Save files, the exe and build noise
# are deliberately excluded.
INCLUDE = ["data", "chars", "stages", "sound", "font", "external", "video"]
SKIP_DIRS = {"save", "__MACOSX", "Thumbs"}
SKIP_EXT = {".exe", ".orig", ".bak", ".lnk", ".db", ".zip", ".7z", ".rar"}


def main() -> int:
    if not SRC.is_dir():
        print(f"missing {SRC}")
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    started = time.time()
    files = 0
    raw = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for top in INCLUDE:
            base = SRC / top
            if not base.is_dir():
                print(f"  skip (absent): {top}")
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    path = Path(dirpath) / name
                    if path.suffix.lower() in SKIP_EXT:
                        continue
                    rel = path.relative_to(SRC).as_posix()
                    try:
                        raw += path.stat().st_size
                        zf.write(path, rel)
                        files += 1
                    except OSError as exc:
                        print(f"  {rel}: {exc}")

    size = OUT.stat().st_size
    print(f"content.zip: {files} files, {raw / 1e9:.2f} GB raw -> {size / 1e6:.0f} MB "
          f"in {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
