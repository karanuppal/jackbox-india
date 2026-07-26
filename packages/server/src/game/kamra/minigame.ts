import type { KamraFloorPlayer, KamraVoteEntry, KsAction, MinigameKind, Stroke } from "@tamasha/shared";

export interface FloorInit {
  playerId: string;
  name: string;
}

export interface MinigameDeps {
  now: () => number;
  /** Deterministic randomness injection for tests (default Math.random). */
  rand: () => number;
  /** Memorize-window length for K2/K3 (scaled by timer modes, QA-M4-3). */
  memorizeMs?: number;
}

/**
 * A Khooni Kamra minigame (PLAN.md §3.4). Runs over the floor players (the
 * living losers of the last question) and determines who dies — always at
 * least one. Skill/memory/luck games resolve from the play phase; social games
 * (worst-answer / worst-drawing) add a voting phase.
 */
export interface Minigame {
  readonly kind: MinigameKind;
  readonly title: string;
  readonly rules: string;
  readonly needsVote: boolean;

  /** Public floor state for the host screen. */
  floorPublic(): KamraFloorPlayer[];
  /** Per-player private state (their math question, grid to memorize, etc.). */
  privateFor(playerId: string): unknown;
  /** Optional shared-screen prompt (e.g. the word to spell). */
  prompt(): string | null;

  /** Handle a floor player's minigame input. Returns true if it advanced state. */
  onInput(playerId: string, action: KsAction): boolean;
  /** True once every floor player has locked in (play phase can resolve). */
  allDone(): boolean;

  /** For voting games: the entries the living non-floor players vote on. */
  voteEntries(): KamraVoteEntry[];
  /** Record a vote AGAINST a floor player (voter is any living non-floor player). */
  onVote(voterId: string, targetId: string): void;

  /** Compute who dies this visit (always >= 1 unless the floor is empty).
   *  Exceptions (§3.4/§3.7): a SOLO floor player can survive luck/skill games,
   *  and universal Dhokha loyalty spares the whole floor. */
  resolveDeaths(): string[];

  /** Money earned inside the minigame (§3.7: K1 ₹25/correct, K2 ₹1000 ×
   *  proportion, K4 ₹100 × word length, K8 pot/forfeit — amounts may be
   *  negative). Empty for the rest. */
  payouts(): { playerId: string; amount: number }[];

  /** The play phase has begun — memorize windows anchor here (SEC-M3-3). */
  beginPlay(now: number): void;
  /** A floor player disconnected — lock their seat (QA-M3-9). */
  forfeit(playerId: string): void;
  /** The room was paused for `delta` ms — shift any wall-clock anchors so
   *  windows don't silently burn during a pause (QA-M4-3). */
  shiftClock(delta: number): void;
}

/** Shared helper: the lowest-scorer(s) die; ties break by killing all tied. */
export function lowestScorersDie(floor: { playerId: string; score: number }[]): string[] {
  if (floor.length === 0) return [];
  const min = Math.min(...floor.map((f) => f.score));
  return floor.filter((f) => f.score === min).map((f) => f.playerId);
}

export type { Stroke };
