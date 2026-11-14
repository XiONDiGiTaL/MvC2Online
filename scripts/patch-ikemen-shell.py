#!/usr/bin/env python3
"""Point the staged shell's archive URL at a versioned `/content.zip?v=…`.

The Worker serves each range slice with a long-lived immutable cache header
only when the URL carries the current archive token, so the browser keeps every
file it has already hydrated and a return visit mostly issues no requests at
all. A new upload changes the token, which invalidates the old slices instead
of mixing bytes from two packs.

Run against the staged copy (`deploy/ikemen/public/main.js`), never against
tools/fiiight.
"""

import sys
from pathlib import Path

HELPER = '''	// Archive location for our hosting layer: the Worker streams content.zip
	// as chunk objects and stamps each slice immutable under this token, so
	// hydrated files survive into the next visit. Falls back to the plain
	// relative path on a static host that has no archive.txt.
	async function archiveUrl() {
		try {
			const r = await fetch("archive.txt", { cache: "no-store" });
			if (r.ok) {
				const v = (await r.text()).trim();
				if (v) return "content.zip?v=" + encodeURIComponent(v);
			}
		} catch (_) { /* optional: plain content.zip still works */ }
		return "content.zip";
	}

'''


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise SystemExit(f"patch target not found: {old[:60]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"patch target is ambiguous ({text.count(old)} matches): {old[:60]!r}")
    return text.replace(old, new)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-ikemen-shell.py <staged main.js>", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")

    if "async function archiveUrl()" in text:
        print("shell already patched")
        return 0

    text = replace_once(text, "async function boot() {\n", HELPER + "	async function boot() {\n		const zipUrl = await archiveUrl();\n")
    text = replace_once(
        text,
        'mountZip("content.zip", "/ikemen", dlProgress)',
        'mountZip(zipUrl, "/ikemen", dlProgress)',
    )
    text = replace_once(
        text,
        'mountZipIndex("content.zip", "/ikemen"',
        'mountZipIndex(zipUrl, "/ikemen"',
    )

    path.write_text(text, encoding="utf-8")
    print(f"patched {path}: archive URL is versioned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
