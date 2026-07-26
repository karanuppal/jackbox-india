// Typed-input profanity filter (PLAN.md §4.4, wired for K5 in M3 per
// QA-M3-6). Three modes: "strict" rejects the submission, "lenient" masks the
// matched word, "off" passes through. The list targets common Hindi + English
// profanity as typed in romanized chat; it is a moderation aid, not a
// guarantee — the VIP censor (§4.3) remains the backstop.

// Each entry matches as a whole word, case-insensitively, with common
// vowel/leet substitutions collapsed first.
const WORDS = [
  // English
  "fuck", "fucker", "fucking", "shit", "bitch", "asshole", "bastard",
  "dick", "cock", "cunt", "pussy", "slut", "whore", "motherfucker",
  // Romanized Hindi
  "bhenchod", "behenchod", "bhenchhod", "bc", "madarchod", "mc",
  "chutiya", "chutia", "chutiye", "chut", "lund", "loda", "lauda",
  "gaandu", "gandu", "gaand", "bhosdike", "bhosdi", "bhosadike",
  "randi", "raand", "harami", "haramzada", "haramzade", "kamina",
  "kutta", "kutte", "kutiya", "saala", "saali", "tatti", "jhaant", "jhant",
] as const;

/** Collapse trivial evasion: leetspeak digits and repeated letters. */
function canonical(word: string): string {
  return word
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/(.)\1+/g, "$1"); // collapse ALL letter runs: fuuuck → fuck, tatti → tati
}

const WORD_SET = new Set<string>(WORDS.map((w) => canonical(w)));

export type ProfanityMode = "off" | "lenient" | "strict";

export interface ProfanityResult {
  /** The text to use (masked under "lenient"), or null when "strict" rejects. */
  text: string | null;
  matched: boolean;
}

/**
 * Apply the room's profanity setting to player-typed text (§4.4).
 * strict → reject on any match; lenient → mask matches with ★; off → as-is.
 */
export function applyProfanityFilter(text: string, mode: ProfanityMode): ProfanityResult {
  if (mode === "off") return { text, matched: false };
  const tokens = text.split(/(\s+)/); // keep separators for reassembly
  let matched = false;
  const out = tokens.map((tok) => {
    if (/^\s*$/.test(tok)) return tok;
    const bare = canonical(tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
    if (bare.length > 0 && WORD_SET.has(bare)) {
      matched = true;
      return tok.replace(/[\p{L}\p{N}]/gu, "★");
    }
    return tok;
  });
  if (!matched) return { text, matched: false };
  if (mode === "strict") return { text: null, matched: true };
  return { text: out.join(""), matched: true };
}
