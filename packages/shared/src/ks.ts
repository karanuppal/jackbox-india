// Khooni Sawaal phase-data shapes shared by the server engine and the client
// renderer. The platform protocol stays game-agnostic (phaseData is `unknown`);
// these types are how the KS game module and its screens agree on that payload.

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
  /** Player ids who answered wrong and died this question (empty on mercy/all-correct). */
  deaths: string[];
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
  vo: string;
}

export type KsPublicPhase =
  | KsTutorialPublic
  | KsQuestionPublic
  | KsRevealPublic
  | KsGameOverPublic;

export interface KsPrivatePhase {
  /** For the question phase: this player's locked choice, or null. */
  myAnswer: number | null;
  answered: boolean;
  /** Ghosts still play but the UI frames it differently. */
  alive: boolean;
}
