#!/usr/bin/env bash
# Push the Ikemen browser build to Cloudflare: shell as Worker assets, the
# content archive and wasm as R2 objects behind the Worker's range handler.
#
#   bash scripts/deploy-ikemen.sh            # shell + code only (fast)
#   bash scripts/deploy-ikemen.sh --content  # also re-upload content.zip + wasm
#
# Needs `npx wrangler login` once. --content is a ~1.75 GiB upload, split into
# 256 MiB chunks because wrangler refuses single uploads over 300 MiB; the
# Worker stitches ranges across the chunks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/deploy/ikemen/wrangler.jsonc"
BUCKET="mvc2-ikemen"
ZIP="$ROOT/tools/fiiight/web/content.zip"
WASM="$ROOT/tools/fiiight/web/ikemen.wasm"
CHUNK=268435456 # 256 MiB
UPLOAD_CONTENT=0

for arg in "$@"; do
	case "$arg" in
		--content) UPLOAD_CONTENT=1 ;;
		*) echo "usage: $0 [--content]" >&2; exit 2 ;;
	esac
done

WRANGLER=(npx --yes wrangler@latest)

bash "$ROOT/scripts/build-ikemen-site.sh"

if [[ "$UPLOAD_CONTENT" -eq 1 ]]; then
	echo "==> ensuring bucket $BUCKET"
	"${WRANGLER[@]}" r2 bucket create "$BUCKET" 2>&1 | grep -v "already exists" || true

	echo "==> uploading ikemen.wasm"
	"${WRANGLER[@]}" r2 object put "$BUCKET/ikemen.wasm" \
		--file "$WASM" --content-type application/wasm --remote

	echo "==> splitting content.zip into $CHUNK-byte chunks"
	TMP="$ROOT/.wrangler/content-chunks"
	rm -rf "$TMP"; mkdir -p "$TMP"
	split -b "$CHUNK" -d -a 1 "$ZIP" "$TMP/part."

	i=0
	for f in "$TMP"/part.*; do
		echo "==> chunk $i ($(basename "$f"))"
		"${WRANGLER[@]}" r2 object put "$BUCKET/content.zip.$i" \
			--file "$f" --content-type application/octet-stream --remote
		i=$((i + 1))
	done

	# Uploaded last: until it exists, /content.zip reports "not uploaded yet"
	# rather than serving ranges from an incomplete archive.
	SIZE=$(wc -c < "$ZIP" | tr -d ' ')
	printf '{"size":%s,"chunk":%s}' "$SIZE" "$CHUNK" > "$TMP/meta.json"
	echo "==> meta: $SIZE bytes in $i chunks"
	"${WRANGLER[@]}" r2 object put "$BUCKET/content.zip.meta" \
		--file "$TMP/meta.json" --content-type application/json --remote

	rm -rf "$TMP"
fi

echo "==> deploying worker"
"${WRANGLER[@]}" deploy --config "$CONFIG"
