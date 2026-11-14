// Local, device-owned profile: no account server, no password to lose.
//
// The identity (id, name, avatar) is persisted in localStorage, so a returning
// player keeps the same name, picture and friends list. `id` is what presence
// and the friends list key on.

import { makeId } from "../net/signal-rt";

export interface Profile {
  id: string;
  name: string;
  /** "@portrait:<roster index>" or a data: URL from an upload */
  avatar: string;
  updated: number;
}

const KEY = "mvc2online.profile.v1";

const randomName = () => "Player" + String(Math.floor(Math.random() * 900) + 100);

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Profile>;
      if (parsed.id && parsed.name) {
        return {
          id: String(parsed.id),
          name: String(parsed.name).slice(0, 24),
          avatar: String(parsed.avatar ?? ""),
          updated: Number(parsed.updated) || 0,
        };
      }
    }
  } catch {
    /* private mode: fall through to a fresh identity */
  }
  return { id: makeId(), name: randomName(), avatar: "@portrait:4", updated: 0 };
}

export function saveProfile(p: Profile): Profile {
  const next = { ...p, name: p.name.trim().slice(0, 24) || randomName(), updated: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* settings still work for this session */
  }
  return next;
}

/** Squeeze an uploaded image into a square data URL small enough for presence. */
export async function avatarFromFile(file: File, size = 128): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Image is too large (12 MB max).");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.82);
}
