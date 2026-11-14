#!/usr/bin/env bash
# Stage the browser shell into deploy/ikemen/public.
#
# The shell is the fiiight build in tools/fiiight/web; the two big payloads
# (content.zip, ikemen.wasm) are NOT copied here — they live in R2 and are
# served through the Worker so they get byte-range support.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/tools/fiiight/web"
OUT="$ROOT/deploy/ikemen/public"

if [[ ! -f "$SRC/ikemen.wasm" ]]; then
	echo "error: $SRC/ikemen.wasm is missing — build the engine first:" >&2
	echo "  cd tools/fiiight/engine && GOTOOLCHAIN=go1.24.7 GOEXPERIMENT=arenas GOOS=js GOARCH=wasm go build -trimpath -o ../web/ikemen.wasm ./src" >&2
	exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

for f in index.html main.js loader.js fs-shim.js touch.js fullscreen.js wasm_exec.js; do
	cp "$SRC/$f" "$OUT/$f"
done
[[ -d "$SRC/icons" ]] && cp -r "$SRC/icons" "$OUT/icons"
[[ -f "$SRC/manifest.json" ]] && cp "$SRC/manifest.json" "$OUT/manifest.json"

# Version the archive URL and keep hydrated slices cacheable (see the patch
# script for why). Never edit the staged copy by hand — it is regenerated.
python "$ROOT/scripts/patch-ikemen-shell.py" "$OUT/main.js"

# Build stamp, shown in the footer and used by "check for updates".
if [[ -f "$SRC/version.txt" ]]; then
	cp "$SRC/version.txt" "$OUT/version.txt"
else
	date -u +"%Y-%m-%dT%H:%M:%SZ" > "$OUT/version.txt"
fi

du -sh "$OUT"
echo "staged shell in $OUT"
