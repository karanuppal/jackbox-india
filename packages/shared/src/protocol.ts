import { z } from "zod";

// ---------------------------------------------------------------------------
// Room phases (PLAN.md §8.2). `paused` is an orthogonal flag, not a phase.
// ---------------------------------------------------------------------------
export const PHASES = [
  "lobby",
  "tutorial",
  "question",
  "reveal",
  "khooniKamra",
  "wheel",
  "finaleIntro",
  "finaleTurn",
  "gameOver",
  "postGame",
] as const;
export type Phase = (typeof PHASES)[number];

export const ROLES = ["host", "player", "audience", "moderator"] as const;
export type Role = (typeof ROLES)[number];

// PLAN.md §3.2 — pinned by tests so a typo cannot ship silently.
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const MAX_AUDIENCE = 200;
export const MAX_NAME_LENGTH = 12;

// Room codes: 4 letters from a 20-letter alphabet with ambiguous letters
// (I, L, O, Q, plus rarely-confused B/G) removed (PLAN.md §4.2).
export const ROOM_CODE_ALPHABET = "ACDEFHJKMNPRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_TTL_MS = 12 * 60 * 60 * 1000; // §4.2: 12h room TTL

// Codes that must never be minted: 4-letter Hindi/English profanity or slurs
// expressible in the room-code alphabet (§4.2). Checked by the generator.
export const ROOM_CODE_BLOCKLIST: readonly string[] = [
  "FUCK",
  "CUNT",
  "SEXY",
  "CHUT",
  "RAND",
  "MUTH",
  "JHAT",
  "KUTA",
  "KUTE",
  "HARM",
  "DEAD",
];

// Join/lookup abuse limits (SEC-M0-13). Enforced by the M1 join path:
// per-IP room-lookup attempts and per-connection message rates.
export const LOOKUP_RATE_LIMIT_PER_MIN = 30;
export const WS_MESSAGES_PER_SEC = 10;

// ---------------------------------------------------------------------------
// Player names — the single most-attacked untrusted field (rendered on the
// shared screen and spliced into runtime TTS). SEC-M0-3.
// ---------------------------------------------------------------------------

// Control chars, bidi overrides, zero-width/joiner, and characters that render
// as blank or nothing (soft hyphen, arabic letter mark, Hangul/other fillers,
// mongolian vowel separator, braille blank, ideographic space, standalone
// variation selectors, tag block). SEC-M0-3 / SEC-M0-R1.
const FORBIDDEN_CODEPOINTS =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/gu;
const FORBIDDEN_CODEPOINTS_ASTRAL = /[\u{E0000}-\u{E01EF}]/gu; // tag characters
const MAX_COMBINING_RUN = 2; // caps zalgo stacking
const COMBINING =
  /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/u;
// After sanitizing, a name must contain at least one visibly-printable
// character (letter/number/punctuation/symbol that is not itself a combining
// mark) — otherwise it renders blank and enables impersonation (SEC-M0-R1).
const HAS_VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** Normalize an untrusted display name. Returns null if nothing survives. */
export function sanitizeName(raw: string): string | null {
  // Whitespace (incl. \t\n) collapses to single spaces BEFORE the forbidden-
  // codepoint strip — otherwise control-class whitespace would glue words.
  let s = raw.normalize("NFC").replace(/\s+/g, " ");
  s = s
    .replace(FORBIDDEN_CODEPOINTS, "")
    .replace(FORBIDDEN_CODEPOINTS_ASTRAL, "")
    .replace(/\s+/g, " ")
    .trim();
  // Cap combining-mark runs (zalgo defense).
  let out = "";
  let run = 0;
  for (const ch of s) {
    if (COMBINING.test(ch)) {
      run += 1;
      if (run > MAX_COMBINING_RUN) continue;
    } else {
      run = 0;
    }
    out += ch;
  }
  out = [...out].slice(0, MAX_NAME_LENGTH).join("").trim();
  // Strip leading combining marks (they attach to UI chrome, not the name) and
  // require at least one visible glyph (SEC-M0-R1).
  while (out.length > 0 && COMBINING.test([...out][0]!)) out = [...out].slice(1).join("");
  return out.length > 0 && HAS_VISIBLE.test(out) ? out : null;
}

/**
 * Normalize untrusted free text that lands on the shared screen / other
 * phones (K5 answers etc., SEC-M3-1/6). Same codepoint hygiene as names —
 * forbidden-codepoint strip, whitespace collapse, zalgo cap, visible-glyph
 * requirement — but with a caller-chosen length cap. Returns null if nothing
 * displayable survives.
 */
export function sanitizeFreeText(raw: string, maxLen: number): string | null {
  let s = raw.normalize("NFC").replace(/\s+/g, " ");
  s = s
    .replace(FORBIDDEN_CODEPOINTS, "")
    .replace(FORBIDDEN_CODEPOINTS_ASTRAL, "")
    .replace(/\s+/g, " ")
    .trim();
  let out = "";
  let run = 0;
  for (const ch of s) {
    if (COMBINING.test(ch)) {
      run += 1;
      if (run > MAX_COMBINING_RUN) continue;
    } else {
      run = 0;
    }
    out += ch;
  }
  out = [...out].slice(0, maxLen).join("").trim();
  while (out.length > 0 && COMBINING.test([...out][0]!)) out = [...out].slice(1).join("");
  return out.length > 0 && HAS_VISIBLE.test(out) ? out : null;
}

export const playerNameSchema = z
  .string()
  .min(1)
  .max(64) // pre-sanitize wire cap; sanitizeName enforces the display cap
  .transform((raw, ctx) => {
    const clean = sanitizeName(raw);
    if (clean === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "empty after sanitize" });
      return z.NEVER;
    }
    return clean;
  });

// ---------------------------------------------------------------------------
// Settings (§4.4). `password` is a secret: it must NEVER appear in any
// payload sent to a non-host client — use toPublicSettings(). SEC-M0-2.
// ---------------------------------------------------------------------------
export const settingsSchema = z.object({
  familyFriendly: z.boolean().default(true),
  profanityFilter: z.enum(["off", "lenient", "strict"]).default("strict"),
  moderation: z.boolean().default(false),
  subtitles: z.boolean().default(true),
  timerMode: z.enum(["normal", "extended", "off"]).default("normal"),
  reducedMotion: z.boolean().default(false),
  audienceEnabled: z.boolean().default(true),
  password: z.string().max(32).nullable().default(null),
  hideRoomCode: z.boolean().default(false),
  controllerOnlyStart: z.boolean().default(false),
  skipTutorial: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});

export type PublicSettings = Omit<Settings, "password"> & {
  passwordRequired: boolean;
};

export function toPublicSettings(s: Settings): PublicSettings {
  const { password, ...rest } = s;
  return { ...rest, passwordRequired: password !== null && password.length > 0 };
}

// ---------------------------------------------------------------------------
// Client -> server actions. Split by required role so authorization is
// type-visible (SEC-M0-5); the server enforces ACTION_ROLE per connection
// identity (bound once at join via sessionToken, then per-socket).
// Game-specific actions travel as an opaque envelope the active game module
// validates (QA-M0-15) — the platform layer knows nothing about trivia.
// ---------------------------------------------------------------------------
export const vipActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("startGame") }),
  z.object({ action: z.literal("skipTutorial") }),
  z.object({ action: z.literal("restart") }),
]);

export const hostActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("updateSettings"), settings: settingsSchema.partial() }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  // Moderation portal (§4.2 table, M7): kick a player / censor a submission.
  z.object({ action: z.literal("kick"), playerId: z.string().uuid() }),
  z.object({ action: z.literal("modCensor"), targetId: z.string().uuid() }),
]);

export const gameActionEnvelopeSchema = z.object({
  action: z.literal("game"),
  payload: z.unknown(), // validated by the active game module's own schema
});

export const clientActionSchema = z.union([
  vipActionSchema,
  hostActionSchema,
  gameActionEnvelopeSchema,
]);
export type ClientAction = z.infer<typeof clientActionSchema>;

/** Minimum identity required to issue each platform action. "moderator"
 *  means the host screen OR a moderator connection (M7 portal). */
export const ACTION_ROLE: Record<string, "vip" | "hostScreen" | "moderator" | "any"> = {
  startGame: "vip",
  skipTutorial: "vip",
  restart: "vip",
  updateSettings: "hostScreen",
  pause: "hostScreen",
  resume: "hostScreen",
  kick: "moderator",
  modCensor: "moderator",
  game: "any",
};

// The wire envelope. `seq` must be strictly monotonic per connection; the
// server ignores stale/duplicate seq (replay defense, SEC-M0-12).
export const clientEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  payload: clientActionSchema,
});
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

// Hard byte cap enforced by the ws receive path BEFORE parsing (SEC-M0-11;
// wired in M1). Drawing strokes get a dedicated larger-capped type in M3.
export const MAX_CLIENT_FRAME_BYTES = 4 * 1024;

// ---------------------------------------------------------------------------
// Khooni Sawaal game actions (game module schema, not platform protocol).
// ---------------------------------------------------------------------------
const strokeSchema = z.object({
  color: z.number().int().min(0).max(3),
  width: z.number().min(0.5).max(20),
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(1).max(120),
});

export const ksActionSchema = z.discriminatedUnion("type", [
  // Trivia answer
  z.object({
    type: z.literal("answer"),
    questionId: z.string().regex(/^q_\d{4}$/),
    optionIndex: z.number().int().min(0).max(3),
  }),
  // Khooni Kamra minigame inputs (§3.4). One discriminant per input shape;
  // the active minigame ignores inputs it doesn't understand.
  z.object({ type: z.literal("kmMath"), value: z.number().int().min(-999).max(999) }),
  z.object({ type: z.literal("kmRecall"), selection: z.array(z.number().int().min(0).max(63)).max(64) }),
  z.object({ type: z.literal("kmSpell"), word: z.string().max(24) }),
  z.object({ type: z.literal("kmAnswer"), text: z.string().max(140) }),
  z.object({ type: z.literal("kmPick"), index: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal("kmChoice"), choice: z.enum(["spare", "betray"]) }),
  z.object({ type: z.literal("kmVote"), targetId: z.string().uuid() }),
  // Drawing (streamed one stroke per frame, §3.4 K6)
  z.object({ type: z.literal("drawStroke"), stroke: strokeSchema }),
  z.object({ type: z.literal("drawUndo") }),
  z.object({ type: z.literal("drawClear") }),
  z.object({ type: z.literal("drawSubmit") }),
]);
export type KsAction = z.infer<typeof ksActionSchema>;

// VIP censor action (host/VIP moderation of player-submitted content, §4.3).
export const censorActionSchema = z.object({
  type: z.literal("censor"),
  targetId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// REST: room creation / lookup (the ecast-style indirection, §4.2).
// ---------------------------------------------------------------------------
export interface CreateRoomResponse {
  code: string;
  hostToken: string; // the host screen's session token; keep secret
  wsPath: string; // where to open the WebSocket
}

export interface RoomLookupResponse {
  exists: boolean;
  phase: Phase | null;
  joinable: boolean; // can still join as an active player
  passwordRequired: boolean;
  audienceEnabled: boolean;
}

// ---------------------------------------------------------------------------
// WebSocket client -> server messages. The first message on a socket MUST be
// `join`; everything else is rejected until the connection is bound to a role.
// ---------------------------------------------------------------------------
export const joinMessageSchema = z.object({
  type: z.literal("join"),
  code: z.string().min(1).max(8),
  // "moderate" (M7): the moderation portal — requires settings.moderation ON
  // and the room password.
  intent: z.enum(["hostScreen", "play", "moderate"]),
  // Player display name (required for intent "play" on a fresh join).
  name: z.string().max(64).optional(),
  // Reconnect: proves prior identity (host token or player session token).
  sessionToken: z.string().uuid().optional(),
  password: z.string().max(32).optional(),
});
export type JoinMessage = z.infer<typeof joinMessageSchema>;

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  joinMessageSchema,
  z.object({ type: z.literal("action"), seq: z.number().int().nonnegative(), payload: clientActionSchema }),
  z.object({ type: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client state views. The server is authoritative; clients are
// renderers. Each role receives a tailored snapshot every time state changes.
// Every server message carries `seq` (monotonic per connection) so a
// reconnecting client can detect gaps and request a snapshot (§4.2).
// ---------------------------------------------------------------------------
export interface PlayerPublic {
  id: string;
  name: string;
  avatar: number; // 0..7
  vip: boolean;
  alive: boolean;
  money: number;
  connected: boolean;
  answered: boolean; // has locked an input for the current phase
}

export interface RoomPublicState {
  code: string;
  phase: Phase;
  paused: boolean;
  settings: PublicSettings; // password never crosses this boundary
  players: PlayerPublic[];
  audienceCount: number;
  questionNumber: number; // 1-based; 0 outside question phases
  questionTotal: number;
  deadline: number | null; // epoch ms; null = untimed
  phaseData: unknown; // per-phase public payload (question text/options, etc.)
}

export interface PrivateView {
  you: PlayerPublic | null; // null for host screen / audience
  role: Role;
  phaseData: unknown; // per-phase private payload (your prompt, your lock state)
  /** §4.4: the generated moderation-portal password — HOST VIEW ONLY. */
  modPassword?: string;
}

export type ServerMessage =
  | { seq: number; type: "joined"; playerId: string; sessionToken: string; role: Role }
  | { seq: number; type: "state"; public: RoomPublicState; private: PrivateView }
  | { seq: number; type: "error"; code: ServerErrorCode; message: string }
  | { seq: number; type: "pong" };

export type ServerErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_LOCKED"
  | "BAD_PASSWORD"
  | "BAD_NAME"
  | "BAD_MESSAGE"
  | "NOT_ALLOWED"
  | "RATE_LIMITED";
