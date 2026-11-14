#!/usr/bin/env node
// Read-only inspection of the supplied NAOMI cart container.
// Prints the header decode, region slots, ROM descriptor table, BIOS strings
// and an 8 MiB entropy map. Never writes to the file.

import { openSync, readSync, fstatSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";

const FILE = process.argv[2] ?? "Marvel vs. Capcom 2.dat";

function read(fd, off, len) {
  const b = Buffer.alloc(len);
  const n = readSync(fd, b, 0, len, off);
  return b.subarray(0, n);
}

const ascii = (buf) => buf.toString("latin1").replace(/[^\x20-\x7e]/g, ".");

const fd = openSync(FILE, "r");
try {
  const size = fstatSync(fd).size;
  console.log(`file      : ${FILE}`);
  console.log(`size      : ${size} bytes (${(size / 1048576).toFixed(2)} MiB)`);

  const head = read(fd, 0, 0x400);
  console.log(`magic     : ${JSON.stringify(ascii(head.subarray(0, 16)).trim())}`);
  console.log(`publisher : ${JSON.stringify(ascii(head.subarray(0x10, 0x30)).trim())}`);

  console.log("\nregion slots (8 x 32 bytes at 0x30):");
  for (let i = 0; i < 8; i++) {
    const off = 0x30 + i * 0x20;
    const label = ascii(head.subarray(off, off + 0x20)).trim();
    console.log(`  0x${off.toString(16).padStart(3, "0")}  ${label ? JSON.stringify(label) : "(blank)"}`);
  }

  const year = head.readUInt16LE(0x130);
  const boardId = ascii(head.subarray(0x133, 0x137));
  console.log(`\nyear @0x130 : ${year}`);
  console.log(`ROM board id: ${JSON.stringify(boardId)}`);

  console.log("\nROM descriptor table (6-byte records, 0xFFFF terminated):");
  let off = 0x15e;
  let n = 0;
  while (off + 6 <= 0x1fe) {
    const flags = head.readUInt16LE(off);
    if (flags === 0xffff) {
      console.log(`  0x${off.toString(16)}  terminator 0xFFFF after ${n} records`);
      break;
    }
    const sum = head.readUInt32LE(off + 2);
    console.log(`  [${String(n).padStart(2, "0")}] flags=0x${flags.toString(16).padStart(4, "0")} checksum=0x${sum.toString(16).padStart(8, "0")}`);
    off += 6;
    n++;
  }

  const swap = read(fd, 0x1e0, 0x60);
  console.log(`\nbyte-swap flags 0x1e0..0x240: ${[...swap.subarray(0, 32)].map((v) => v.toString(16).padStart(2, "0")).join(" ")}`);

  const strings = read(fd, 0x200, 0x100);
  const txt = ascii(strings).match(/[\x20-\x7e]{6,}/g) ?? [];
  console.log(`BIOS strings        : ${txt.map((t) => JSON.stringify(t.trim())).join(", ") || "(none)"}`);

  console.log("\nentropy map (8 MiB windows):");
  const win = 8 * 1024 * 1024;
  for (let o = 0; o < size; o += win) {
    const len = Math.min(win, size - o);
    const b = read(fd, o, len);
    const f = new Float64Array(256);
    for (const v of b) f[v]++;
    let H = 0;
    for (const c of f) if (c) {
      const p = c / len;
      H -= p * Math.log2(p);
    }
    const zeros = ((f[0] / len) * 100).toFixed(1);
    const ff = ((f[255] / len) * 100).toFixed(1);
    console.log(
      `  0x${o.toString(16).padStart(9, "0")}  ${H.toFixed(3)} bits/byte  zeros=${zeros}%  0xFF=${ff}%`
    );
  }

  const hash = createHash("sha256");
  const CH = 8 * 1024 * 1024;
  for (let o = 0; o < size; o += CH) hash.update(read(fd, o, Math.min(CH, size - o)));
  console.log(`\nsha256    : ${hash.digest("hex")}`);
} finally {
  closeSync(fd);
}
