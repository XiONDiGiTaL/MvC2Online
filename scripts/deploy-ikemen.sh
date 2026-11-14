#!/usr/bin/env bash
# Push the Ikemen browser build to Cloudflare: shell as Worker assets, the
# content zip and wasm as R2 objects behind the Worker's range handler.
#
#   bash scripts/deploy-ikemen.sh            # shell + code only (fast)
#   bash scripts/deploy-ikemen.sh --content  # also re-upload content.zip + wasm
#
# Needs `npx wrangler login` once. --content is a ~1.9 GB upload.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/deploy/ikemen/wrangler.jsonc"
BUCKET="mvc2-ikemen"
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
		--file "$ROOT/tools/fiiight/web/ikemen.wasm" \
		--content-type application/wasm --remote

	echo "==> uploading content.zip (this is the long one)"
	"${WRANGLER[@]}" r2 object put "$BUCKET/content.zip" \
		--file "$ROOT/tools/fiiight/web/content.zip" \
		--content-type application/zip --remote
fi

echo "==> deploying worker"
"${WRANGLER[@]}" deploy --config "$CONFIG"
