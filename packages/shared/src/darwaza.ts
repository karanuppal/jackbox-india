// Aakhri Darwaza finale shared types (PLAN.md §3.6) — the pre-dawn escape
// from Manzil Mahal. Verbatim TMP "Exit" mechanics with localized dressing:
// a linear track of spaces to the exit door, judged-category movement, ghost
// body-stealing, an advancing wall of darkness, and the TMP2 door barrier.

import { z } from "zod";

/** Timers (ms). §3.6: the 12s judgment turn is NOT extendable — the finale
 *  ignores the room's extended-timer setting (TMP2 rule). */
export const FINALE_TIMERS = {
  introMs: 7000,
  turnMs: 12000,
  resolveMs: 6000,
} as const;

/** Track geometry (§3.6): distances are spaces-from-the-exit-door. */
export const FINALE_START_LIVING = 14;
export const FINALE_GHOST_PACK = 21;
/** The 3 richest ghosts start this many spaces AHEAD of the pack. */
export const FINALE_GHOST_HEADSTARTS = [3, 2, 1] as const;
export const FINALE_DARKNESS_START = 26;
/** Darkness starts sweeping after this many category turns (2 in solo). */
export const FINALE_DARKNESS_DELAY = 3;
export const FINALE_DARKNESS_DELAY_SOLO = 2;
/** Darkness advances 2–3 spaces per turn (§3.6). */
export const FINALE_DARKNESS_ADVANCE_MIN = 2;
export const FINALE_DARKNESS_ADVANCE_MAX = 3;
/** The door barrier sits 2 spaces out; only a PERFECT judgment turn crosses. */
export const FINALE_BARRIER = 2;
/** Candidate options per judgment turn (§3.6). Solo games use 3 for the
 *  living player too. */
export const FINALE_LIVING_OPTIONS = 2;
export const FINALE_GHOST_OPTIONS = 3;

/** The audience races as one collective extra ghost runner (§3.6). */
export const AUDIENCE_RUNNER_ID = "audience";

/** A finale judgment: toggle-select every option you believe fits, lock in.
 *  `turn` guards against a stale lock landing on the next turn. */
export const fjActionSchema = z.object({
  type: z.literal("fjJudge"),
  turn: z.number().int().nonnegative(),
  selection: z.array(z.number().int().min(0).max(7)).max(8),
});
export type FjAction = z.infer<typeof fjActionSchema>;

export interface FinaleRunnerPublic {
  id: string; // playerId, or AUDIENCE_RUNNER_ID for the audience runner
  name: string;
  kind: "living" | "ghost" | "audience";
  /** Spaces from the exit door (0 = crossed). */
  distance: number;
  eliminated: boolean;
  /** Spaces moved in the last resolve (for the host animation). */
  lastMove: number;
  /** Locked a judgment this turn. */
  locked: boolean;
}

export type FinaleEvent =
  | { type: "steal"; byId: string; fromId: string }
  | { type: "darkness"; id: string }
  | { type: "barrier"; id: string }
  | { type: "escape"; id: string };

export interface FinaleIntroPublic {
  kind: "finaleIntro";
  runners: FinaleRunnerPublic[];
  vo: string;
}

export interface FinaleTurnPublic {
  kind: "finaleTurn";
  sub: "judge" | "resolve";
  /** 1-based turn number. */
  turn: number;
  categoryTitle: string;
  runners: FinaleRunnerPublic[];
  /** Distance of the darkness wall from the exit (runners at >= this are
   *  swallowed). Starts beyond the track and sweeps in. */
  darkness: number;
  /** What happened in the last resolve (steals, eliminations, barrier hits). */
  events: FinaleEvent[];
  vo: string;
}

export type FinalePublic = FinaleIntroPublic | FinaleTurnPublic;

export interface FinalePrivate {
  /** True if this player (or audience member) is racing this turn. */
  racing: boolean;
  /** The candidate options assigned to this runner for the current turn. */
  options: { index: number; text: string }[] | null;
  selection: number[] | null;
  locked: boolean;
}
