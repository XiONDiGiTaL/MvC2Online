#!/usr/bin/env node
// Guard rail: the proprietary game data must never be committed or shipped.
// Prints the hash (for the owner's own record) and fails loudly if the file is
// git-tracked or present in the build output.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const FILE = "Marvel vs. Capcom 2.dat";
let bad = false;

if (!existsSync(FILE)) {
  console.log(`[verify:dat] ${FILE} not present (nothing to leak).`);
} else {
  const size = statSync(FILE).size;
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(FILE)
      .on("data", (c) => hash.update(c))
      .on("end", resolve)
      .on("error", reject);
  });
  console.log(`[verify:dat] size   : ${size} bytes`);
  console.log(`[verify:dat] sha256 : ${hash.digest("hex")}`);
}

try {
  const tracked = execSync(`git ls-files -- "${FILE}"`, { encoding: "utf8" }).trim();
  if (tracked) {
    console.error(`[verify:dat] FAIL: ${FILE} is tracked by git.`);
    bad = true;
  } else {
    console.log(`[verify:dat] ok: game data is not tracked by git.`);
  }
} catch {
  console.log("[verify:dat] git not available; skipped tracking check.");
}

for (const dir of ["dist", "dist-server"]) {
  if (!existsSync(dir)) continue;
  const found = execSync(`find "${dir}" -name "*.dat" -o -name "*.zip" 2>/dev/null | head -5`, {
    encoding: "utf8",
    shell: "/bin/bash",
  }).trim();
  if (found) {
    console.error(`[verify:dat] FAIL: archive data found in ${dir}:\n${found}`);
    bad = true;
  }
}

if (bad) process.exit(1);
console.log("[verify:dat] pass");
