// Session-token persistence for reconnection (PLAN.md §4.2). Identity is the
// token, not the socket; it survives reloads/backgrounding via localStorage.

const keyFor = (code: string) => `tamasha:session:${code.toUpperCase()}`;

export interface StoredSession {
  code: string;
  name: string;
  sessionToken: string;
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function storage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* access denied (private mode) */
  }
  return null;
}

export function saveSession(s: StoredSession, store: StorageLike | null = storage()): void {
  if (store === null) return;
  try {
    store.setItem(keyFor(s.code), JSON.stringify(s));
  } catch {
    /* quota / denied — reconnection simply won't persist */
  }
}

export function loadSession(code: string, store: StorageLike | null = storage()): StoredSession | null {
  if (store === null) return null;
  try {
    const raw = store.getItem(keyFor(code));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StoredSession).sessionToken === "string" &&
      typeof (parsed as StoredSession).name === "string" &&
      typeof (parsed as StoredSession).code === "string"
    ) {
      return parsed as StoredSession;
    }
  } catch {
    /* malformed — ignore */
  }
  return null;
}

export function clearSession(code: string, store: StorageLike | null = storage()): void {
  if (store === null) return;
  try {
    store.removeItem(keyFor(code));
  } catch {
    /* ignore */
  }
}
