// Khooni Kamra (killing-floor) shared types (PLAN.md §3.4). When living players
// answer a trivia question wrong (and it isn't a mercy), they are sent to the
// Khooni Kamra where one of 8 minigames runs; at least one loser dies. The
// minigame kinds and their public/private payloads are defined here so the
// server sub-engines and the client renderers agree.

export const MINIGAME_KINDS = [
  "hisaabKitaab", // K1 rapid mental math (skill)
  "yaaddasht", // K2 memory grid (memory)
  "taashKePatte", // K3 card recall (memory)
  "spellingShelling", // K4 spelling (skill)
  "sabseGhatiyaJawaab", // K5 worst-answer voting (social)
  "gandaChitra", // K6 worst-drawing voting (social/draw)
  "zeharWaliChai", // K7 poisoned cup (luck)
  "dhokha", // K8 betrayal split (social)
] as const;
export type MinigameKind = (typeof MINIGAME_KINDS)[number];

// Minigames that require >=2 floor players and >=1 living voter (§3.4).
export const VOTING_MINIGAMES: readonly MinigameKind[] = ["sabseGhatiyaJawaab", "gandaChitra"];

/** Timers (ms) for the killing-floor sub-phases. Kamra phases are ALWAYS
 *  timed regardless of the room's timerMode — the killing floor is a race
 *  (mirroring TMP; the finale likewise ignores extended timers, §3.6). */
export const KAMRA_TIMERS = {
  introMs: 3500,
  playMs: 25000,
  voteMs: 15000,
  resultMs: 5000,
  wheelSpinMs: 4000,
  /** Pause on the landed wheel outcome before the next spin. */
  wheelLandMs: 2500,
  /** K2/K3 memorize window — enforced SERVER-side (SEC-M3-3): the pattern is
   *  only present in private snapshots (and recall input rejected) while the
   *  window is open. */
  memorizeMs: 6000,
} as const;

/** K8 Dhokha stakes (§3.7, QA-M3-5): a unique betrayer takes the pot; under
 *  universal loyalty everyone survives but forfeits money to the house
 *  (PLAN.md amendments, 2026-07-26). */
export const DHOKHA_POT = 1000;
export const DHOKHA_LOYALTY_FORFEIT = 500;

/** K1 payout ceiling: ₹25 × at most this many corrects (SEC-M3-7). */
export const MATH_PAYOUT_CAP = 40;

/** Maut Ka Chakra odds (§3.3): 5 death segments : 1 life segment. */
export const WHEEL_DEATH_SEGMENTS = 5;
export const WHEEL_TOTAL_SEGMENTS = 6;

/** §3.4: a solo floor player faces luck/skill games only (no vote, no memory),
 *  and death is possible but NOT guaranteed. */
export const SOLO_MINIGAMES: readonly MinigameKind[] = [
  "hisaabKitaab",
  "spellingShelling",
  "zeharWaliChai",
];

/** Solo Hisaab-Kitaab survival bar: at least this many correct sums. */
export const SOLO_MATH_SURVIVAL = 3;

// --- per-floor-player state visible on the host screen --------------------
export interface KamraFloorPlayer {
  playerId: string;
  name: string;
  /** Progress/score within the minigame (interpretation is per-kind). */
  score: number;
  done: boolean; // submitted / locked in
}

// --- public phase payloads (host screen) ----------------------------------
export interface KamraIntroPublic {
  kind: "kamraIntro";
  minigame: MinigameKind;
  title: string;
  rules: string;
  floor: KamraFloorPlayer[];
  vo: string;
}

export interface KamraPlayPublic {
  kind: "kamraPlay";
  minigame: MinigameKind;
  floor: KamraFloorPlayer[];
  /** Optional prompt shown on the shared screen (e.g. the word to spell). */
  prompt: string | null;
  vo: string;
}

export interface KamraVotePublic {
  kind: "kamraVote";
  minigame: MinigameKind;
  /** The submissions being voted on (answers or drawings). */
  entries: KamraVoteEntry[];
  vo: string;
}

export interface KamraVoteEntry {
  playerId: string;
  name: string;
  /** Text answer (K5) or serialized drawing strokes (K6). Nulled when the
   *  entry is censored — it stays ON the ballot as a blank card (UT-M3-2). */
  text: string | null;
  strokes: Stroke[] | null;
  /** VIP-censored: content hidden, still votable and still death-eligible. */
  censored: boolean;
  votesAgainst: number;
}

export interface KamraResultPublic {
  kind: "kamraResult";
  minigame: MinigameKind;
  /** Who died on the floor this visit (>=1). */
  deaths: string[];
  survivors: string[];
  /** For voting games: the final ballot with tallies, so the room gets its
   *  payoff — the fatal chitra/jawaab on screen (UT-M3-14). Empty otherwise. */
  entries: KamraVoteEntry[];
  vo: string;
}

export interface WheelPublic {
  kind: "wheel";
  /** The player currently spinning. */
  spinnerId: string;
  spinnerName: string;
  /** Result of the spin once landed: "life" | "death" | null while spinning. */
  outcome: "life" | "death" | null;
  vo: string;
}

export type KamraPublicPhase =
  | KamraIntroPublic
  | KamraPlayPublic
  | KamraVotePublic
  | KamraResultPublic
  | WheelPublic;

// --- private payloads (per floor player's phone) --------------------------
export interface KamraPrivate {
  /** True if this player is on the killing floor this round. */
  onFloor: boolean;
  /** Per-kind private state (the math question, the grid to memorize, …). */
  data: unknown;
  done: boolean;
}

// --- drawing (K6 / future Drawful) ----------------------------------------
export interface Stroke {
  color: number; // palette index
  width: number;
  /** Normalized points in a 0..1 virtual canvas (renders at any resolution). */
  points: [number, number][];
}

// Drawings are streamed one stroke per message so each frame stays under the
// 4KB pre-parse cap (SEC-M0-11); the server accumulates up to MAX_STROKES.
export const MAX_STROKES = 60;
export const MAX_POINTS_PER_STROKE = 120;
export const DRAW_PALETTE = ["#1a0508", "#c0182b", "#f5a623", "#7fd8d8"] as const;
