// Supabase accounts: email + password, so a player's username, avatar and
// friends follow them to any device.
//
// No SDK: the auth endpoints are plain JSON over fetch, and the session lives
// in localStorage as an access/refresh pair that is refreshed when it expires.
// The publishable (anon) key is the only credential in the client — every table
// is protected by row-level security keyed on auth.uid().

import { loadRealtimeConfig } from "./signal-rt";

export interface AccountSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  /** epoch ms; refreshed ahead of expiry */
  expiresAt: number;
}

export interface RemoteProfile {
  username: string;
  avatar: string;
}

export interface RemoteFriend {
  id: string;
  name: string;
}

const SESSION_KEY = "mvc2online.account.v1";

interface Endpoint {
  url: string;
  key: string;
}

let endpoint: Endpoint | null = null;

async function ep(): Promise<Endpoint> {
  if (endpoint) return endpoint;
  const cfg = await loadRealtimeConfig();
  if (!cfg) throw new Error("Accounts are not configured on this build.");
  endpoint = { url: cfg.url.replace(/\/$/, ""), key: cfg.key };
  return endpoint;
}

function decodeSub(token: string): string {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
    return String(json.sub ?? "");
  } catch {
    return "";
  }
}

function toSession(body: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id?: string; email?: string };
}): AccountSession | null {
  if (!body.access_token || !body.refresh_token) return null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    userId: String(body.user?.id ?? decodeSub(body.access_token)),
    email: String(body.user?.email ?? ""),
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60_000,
  };
}

export function loadSession(): AccountSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AccountSession;
    if (!s?.accessToken || !s?.refreshToken || !s?.userId) return null;
    return s;
  } catch {
    return null;
  }
}

function storeSession(s: AccountSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: the session still works until reload */
  }
}

async function authPost(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const { url, key } = await ep();
  const res = await fetch(`${url}/auth/v1${path}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export interface SignUpResult {
  session?: AccountSession;
  /** true when the project requires clicking an emailed confirmation link */
  needsConfirm?: boolean;
}

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const { status, json } = await authPost("/signup", { email, password });
  if (status >= 400) {
    throw new Error(json?.msg || json?.message || "Could not create that account.");
  }
  const session = toSession(json ?? {});
  if (session) {
    storeSession(session);
    return { session };
  }
  return { needsConfirm: true };
}

export async function signIn(email: string, password: string): Promise<AccountSession> {
  const { status, json } = await authPost("/token?grant_type=password", { email, password });
  if (status >= 400) {
    const msg = String(json?.error_description ?? json?.msg ?? "");
    if (/email not confirmed/i.test(msg)) {
      throw new Error("Confirm your email first, then sign in.");
    }
    if (/invalid/i.test(msg)) throw new Error("Wrong email or password.");
    throw new Error(msg || "Could not sign in.");
  }
  const session = toSession(json ?? {});
  if (!session) throw new Error("Sign-in returned no session.");
  storeSession(session);
  return session;
}

/** Returns a session with time left on it, refreshing first when needed. */
export async function ensureSession(): Promise<AccountSession | null> {
  const current = loadSession();
  if (!current) return null;
  if (current.expiresAt > Date.now()) return current;
  const { status, json } = await authPost("/token?grant_type=refresh_token", {
    refresh_token: current.refreshToken,
  });
  if (status >= 400) {
    storeSession(null);
    return null;
  }
  const next = toSession(json ?? {});
  if (!next) {
    storeSession(null);
    return null;
  }
  storeSession(next);
  return next;
}

export function signOut() {
  storeSession(null);
}

async function rest<T>(
  session: AccountSession,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const { url, key } = await ep();
  const run = (token: string) => fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  let res = await run(session.accessToken);
  if (res.status === 401) {
    const fresh = await ensureSession();
    if (!fresh) throw new Error("Session expired — sign in again.");
    res = await run(fresh.accessToken);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Account service error (${res.status})${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

export async function fetchRemoteProfile(session: AccountSession): Promise<RemoteProfile | null> {
  const rows = await rest<RemoteProfile[]>(
    session,
    `/profiles?select=username,avatar&id=eq.${encodeURIComponent(session.userId)}`,
  );
  const row = rows?.[0];
  return row ? { username: row.username, avatar: row.avatar ?? "" } : null;
}

export async function pushRemoteProfile(session: AccountSession, profile: RemoteProfile): Promise<void> {
  await rest(session, `/profiles?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: session.userId,
      username: profile.username,
      avatar: profile.avatar,
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function fetchRemoteFriends(session: AccountSession): Promise<RemoteFriend[]> {
  const rows = await rest<{ friend_id: string; friend_name: string }[]>(
    session,
    `/friends?select=friend_id,friend_name&order=friend_name.asc`,
  );
  return (rows ?? []).map((r) => ({ id: r.friend_id, name: r.friend_name }));
}

export async function addRemoteFriend(
  session: AccountSession,
  friend: RemoteFriend,
): Promise<void> {
  await rest(session, `/friends?on_conflict=user_id,friend_id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: session.userId, friend_id: friend.id, friend_name: friend.name }),
  });
}

export async function removeRemoteFriend(session: AccountSession, friendId: string): Promise<void> {
  await rest(
    session,
    `/friends?user_id=eq.${encodeURIComponent(session.userId)}&friend_id=eq.${encodeURIComponent(friendId)}`,
    { method: "DELETE" },
  );
}
