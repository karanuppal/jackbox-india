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

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const MAX_AUDIENCE = 200;
export const MAX_NAME_LENGTH = 12;

// Room codes: 4 letters from a 20-letter alphabet with ambiguous letters
// (I, L, O, Q, plus rarely-confused B/G) removed (PLAN.md §4.2).
export const ROOM_CODE_ALPHABET = "ACDEFHJKMNPRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

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

// ---------------------------------------------------------------------------
// Client -> server actions
// ---------------------------------------------------------------------------
export const clientActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("startGame") }), // VIP "Sab Aa Gaye!"
  z.object({ action: z.literal("skipTutorial") }), // VIP
  z.object({
    action: z.literal("updateSettings"),
    settings: settingsSchema.partial(),
  }), // host screen, lobby only
  z.object({ action: z.literal("pause") }), // host screen
  z.object({ action: z.literal("resume") }), // host screen
  z.object({
    action: z.literal("answer"),
    questionId: z.string(),
    optionIndex: z.number().int().min(0).max(3),
  }),
  z.object({ action: z.literal("restart") }), // VIP, postGame
]);
export type ClientAction = z.infer<typeof clientActionSchema>;

export const clientEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  payload: clientActionSchema,
});
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

// Hard byte cap on any inbound frame (DoS guard; drawing strokes get their
// own dedicated, larger-capped message type when M3 lands).
export const MAX_CLIENT_FRAME_BYTES = 4 * 1024;

// ---------------------------------------------------------------------------
// Server -> client state views. The server is authoritative; clients are
// renderers. Each role receives a tailored snapshot every time state changes.
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
  settings: Settings;
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
}

export type ServerMessage =
  | { type: "joined"; playerId: string; sessionToken: string; role: Role }
  | { type: "state"; seq: number; public: RoomPublicState; private: PrivateView }
  | { type: "error"; code: ServerErrorCode; message: string }
  | { type: "pong" };

export type ServerErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_LOCKED"
  | "BAD_PASSWORD"
  | "BAD_NAME"
  | "BAD_MESSAGE"
  | "NOT_ALLOWED"
  | "RATE_LIMITED";
