// Khooni Sawaal phase-data shapes shared by the server engine and the client
// renderer. The platform protocol stays game-agnostic (phaseData is `unknown`);
// these types are how the KS game module and its screens agree on that payload.

import type { FinalePrivate, FinalePublic } from "./darwaza.js";
import type { KamraPrivate, KamraPublicPhase } from "./kamra.js";

export const QUESTION_BUDGET = 10;
export const CORRECT_REWARD = 1000;

// Timers (ms). Extended doubles; "off" waits for all answers (§3.3).
export const TIMERS = {
  tutorialMs: 9000,
  questionMs: 30000,
  revealMs: 6000,
  interstitialMs: 3500,
} as const;

export interface KsQuestionPublic {
  kind: "question";
  questionId: string;
  text: string;
  options: [string, string, string, string];
  number: number; // 1-based
  total: number;
  vo: string; // Mishra Ji's line (subtitle text; audio in M6)
}

export interface KsRevealOptionTally {
  index: number;
  count: number; // how many players picked it
  correct: boolean;
}

export interface KsRevealPublic {
  kind: "reveal";
  questionId: string;
  text: string;
  options: [string, string, string, string];
  correct: number;
  tally: KsRevealOptionTally[];
  /**
   * Player ids who died AT the reveal. Since M3 wrong answers send players to
   * the Khooni Kamra instead of killing directly, this is only non-empty for
   * edge paths; kamra deaths are announced in the kamraResult phase (§3.4).
   */
  deaths: string[];
  /** Living players sentenced to the Khooni Kamra this question (§3.4). */
  floor: string[];
  mercy: boolean;
  allCorrect: boolean;
  vo: string;
}

export interface KsTutorialPublic {
  kind: "tutorial";
  vo: string;
}

export interface KsStanding {
  playerId: string;
  name: string;
  money: number;
  alive: boolean;
}

export interface KsGameOverPublic {
  kind: "gameOver";
  standings: KsStanding[]; // sorted best-first
  winnerId: string | null;
  /** How the Aakhri Darwaza ended, when the game reached it (§3.6, M4). */
  finale?: { escaped: boolean; audienceEscaped: boolean };
  vo: string;
}

export type KsPublicPhase =
  | KsTutorialPublic
  | KsQuestionPublic
  | KsRevealPublic
  | KsGameOverPublic
  | KamraPublicPhase
  | FinalePublic;

export interface KsPrivatePhase {
  /** For the question phase: this player's locked choice, or null. */
  myAnswer: number | null;
  answered: boolean;
  /** Ghosts still play but the UI frames it differently. */
  alive: boolean;
  /** Khooni Kamra per-player state; null outside the kamra phase (§3.4). */
  kamra: KamraPrivate | null;
  /** Aakhri Darwaza per-runner state; null outside the finale (§3.6, M4). */
  finale: FinalePrivate | null;
}
