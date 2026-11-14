// Local input injector for Remote Play.
//
// The viewer's buttons arrive in the host's browser tab, which posts them here;
// this process feeds them to a single long-lived PowerShell that calls
// user32!keybd_event, so there is no per-keystroke process spawn. No driver, no
// admin rights, nothing installed system-wide.
//
//   node scripts/remote-input.mjs
//
// Keys go to whichever window has focus, so keep the game focused while playing.

import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.REMOTE_INPUT_PORT || 8788);

const VK = {
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, G: 0x47, H: 0x48,
  I: 0x49, J: 0x4a, K: 0x4b, L: 0x4c, M: 0x4d, N: 0x4e, O: 0x4f, P: 0x50,
  Q: 0x51, R: 0x52, S: 0x53, T: 0x54, U: 0x55, V: 0x56, W: 0x57, X: 0x58,
  Y: 0x59, Z: 0x5a,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  Numpad4: 0x64, Numpad6: 0x66, Numpad8: 0x68, Numpad2: 0x62, Numpad5: 0x65,
  Space: 0x20, Enter: 0x0d, Escape: 0x1b, Shift: 0x10,
};

const PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class XionKey {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
  public static void Down(int vk) { keybd_event((byte)vk, 0, 0, UIntPtr.Zero); }
  public static void Up(int vk) { keybd_event((byte)vk, 0, 2, UIntPtr.Zero); }
}
"@
[Console]::Out.WriteLine("READY")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  if ($p.Length -eq 2) {
    try {
      if ($p[0] -eq 'down') { [XionKey]::Down([int]$p[1]) } else { [XionKey]::Up([int]$p[1]) }
    } catch { }
  }
}
`;

const ps = spawn(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
  { stdio: ["pipe", "pipe", "inherit"] }
);
ps.stdin.write(PS);
ps.stdout.on("data", (b) => {
  const text = b.toString();
  if (text.includes("READY")) console.log("[inject] PowerShell ready");
});
ps.on("exit", (code) => {
  console.error(`[inject] PowerShell exited (${code})`);
  process.exit(1);
});

/** Send one key transition. Unknown keys are ignored rather than guessed. */
function inject(key, down) {
  const vk = VK[key];
  if (!vk) {
    console.warn(`[inject] unknown key "${key}"`);
    return false;
  }
  if (!ps.stdin.writable) return false;
  ps.stdin.write(`${down ? "down" : "up"} ${vk}\n`);
  return true;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...CORS, "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, keys: Object.keys(VK).length }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/input") {
    res.writeHead(404, CORS);
    res.end("not found");
    return;
  }
  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let msg;
    try {
      msg = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, CORS);
      res.end("bad json");
      return;
    }
    // Accept a batch so a dropped frame of movement can't strand a held key.
    const events = Array.isArray(msg.events) ? msg.events : [{ key: msg.key, down: msg.down }];
    let applied = 0;
    for (const e of events) if (e && inject(String(e.key), !!e.down)) applied++;
    res.writeHead(200, { ...CORS, "content-type": "application/json" });
    res.end(JSON.stringify({ applied }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[inject] listening on http://127.0.0.1:${PORT} — keys go to the focused window`);
});

const shutdown = () => {
  try {
    ps.stdin.end("exit\n");
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
