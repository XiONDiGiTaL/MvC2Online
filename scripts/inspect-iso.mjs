// Read-only ISO9660 directory listing for a raw disc image (.bin/.iso).
// Handles both 2048-byte cooked images and 2352-byte raw MODE1/MODE2 dumps.
// It prints structure only: names, LBAs and sizes, never file contents.
import { open } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/inspect-iso.mjs <disc.bin>");
  process.exit(1);
}

const fh = await open(path, "r");
const head = Buffer.alloc(64 * 1024);
await fh.read(head, 0, head.length, 0);

function findPvd() {
  const candidates = [
    { sector: 2048, user: 0, label: "cooked 2048" },
    { sector: 2352, user: 16, label: "raw 2352 MODE1" },
    { sector: 2352, user: 24, label: "raw 2352 MODE2" },
  ];
  for (const c of candidates) {
    const off = 16 * c.sector + c.user;
    if (head.length > off + 6 && head.toString("latin1", off + 1, off + 6) === "CD001") {
      return c;
    }
  }
  return null;
}

const layout = findPvd();
if (!layout) {
  console.error("No ISO9660 primary volume descriptor found — this may not be a disc image.");
  process.exit(2);
}

console.log(`image:  ${path}`);
console.log(`layout: ${layout.label}`);
const pvd = 16 * layout.sector + layout.user;
const volumeId = head.toString("latin1", pvd + 40, pvd + 72).trim();
console.log(`volume: ${volumeId}`);

const rootLba = head.readUInt32LE(pvd + 158);
const rootLen = head.readUInt32LE(pvd + 166);
console.log(`root:   LBA ${rootLba} (${rootLen} bytes)\n`);

// Raw 2352-byte images interleave 2048 bytes of data with headers and ECC, so
// an extent has to be read one sector at a time rather than as a byte range.
async function readExtent(lba, length) {
  const out = Buffer.alloc(length);
  const per = 2048;
  const tmp = Buffer.alloc(per);
  const sectors = Math.ceil(length / per);
  for (let i = 0; i < sectors; i++) {
    await fh.read(tmp, 0, per, (lba + i) * layout.sector + layout.user);
    tmp.copy(out, i * per, 0, Math.min(per, length - i * per));
  }
  return out;
}

const afsEntries = [];

async function listDir(lba, length, prefix = "", depth = 0) {
  const buf = await readExtent(lba, length);
  let off = 0;
  while (off < buf.length) {
    const recLen = buf[off];
    if (recLen === 0) {
      off = Math.ceil((off + 1) / 2048) * 2048;
      continue;
    }
    const rec = buf.subarray(off, off + recLen);
    const extLba = rec.readUInt32LE(2);
    const size = rec.readUInt32LE(10);
    const flags = rec[25];
    const nameLen = rec[32];
    const rawName = rec.toString("latin1", 33, 33 + nameLen);
    const name = rawName.replace(/;\d+$/, "");
    off += recLen;
    if (name === "." || name === ".." || rawName === "" || rawName.charCodeAt(0) === 0) continue;
    const isDir = (flags & 0x02) !== 0;
    const kb = (size / 1024).toFixed(0).padStart(9);
    if (/^AFS\d+\.AFS$/i.test(name) && !afsEntries.some((a) => a.name === name)) {
      afsEntries.push({ name, lba: extLba, size });
    }
    console.log(`${prefix}${isDir ? "[D]" : "   "} ${kb} KB  ${name}`);
    if (isDir && depth < 2) {
      await listDir(extLba, size, `${prefix}    `, depth + 1);
    }
  }
}

await listDir(rootLba, rootLen);

// AFS is CRI's simple container: "AFS\0", a count, then (offset,size) pairs.
// Index only — this never reads the payload.
for (const afs of afsEntries) {
  const header = await readExtent(afs.lba, 16);
  if (header.toString("latin1", 0, 4) !== "AFS\0") {
    console.log(`\n${afs.name}: not an AFS container`);
    continue;
  }
  const count = header.readUInt32LE(4);
  const indexLen = Math.min(8 + count * 8, afs.size);
  const index = await readExtent(afs.lba, indexLen);
  let bytes = 0;
  let biggest = 0;
  let empty = 0;
  for (let i = 0; i < count; i++) {
    const off = index.readUInt32LE(8 + i * 8);
    const len = index.readUInt32LE(12 + i * 8);
    bytes += len;
    if (len > biggest) biggest = len;
    if (len === 0 || off === 0) empty++;
  }
  console.log(`\n${afs.name}: ${count} entries, ${(bytes / 1048576).toFixed(1)} MB, largest ${(biggest / 1024).toFixed(0)} KB, ${empty} empty`);
}

await fh.close();
