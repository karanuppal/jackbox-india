import { randomInt } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_BLOCKLIST, ROOM_CODE_LENGTH } from "@tamasha/shared";

/** Generate one candidate code from the unambiguous alphabet. */
export function randomCode(): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/** True if the code is well-formed and not on the profanity blocklist. */
export function isAcceptableCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return !ROOM_CODE_BLOCKLIST.includes(code);
}

/** Normalize user-typed codes (case-insensitive, trimmed). */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Generate a code not present in `taken` and not blocklisted.
 * Throws only if the space is exhausted (practically impossible at our scale).
 */
export function generateUniqueCode(taken: (code: string) => boolean, maxTries = 1000): string {
  for (let i = 0; i < maxTries; i++) {
    const code = randomCode();
    if (isAcceptableCode(code) && !taken(code)) return code;
  }
  throw new Error("room code space exhausted");
}
