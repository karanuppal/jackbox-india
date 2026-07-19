import type { Settings } from "@tamasha/shared";

/**
 * A game module implements this against the platform's room. The platform
 * layer (room, ws hub) knows nothing about trivia — it only drives phases,
 * timers, and snapshots through this contract (PLAN.md §8.2).
 *
 * For M1 the only game state is the lobby handoff; the trivia engine lands in
 * M2. The interface is defined now so M2 slots in without touching the room.
 */
export interface GamePlayer {
  id: string;
  name: string;
  avatar: number;
}

export interface EnginePhase {
  /** Platform phase name (must be one of shared PHASES). */
  phase: string;
  /** Absolute epoch-ms deadline for the current phase, or null if untimed. */
  deadline: number | null;
}

export interface GameContext {
  players: GamePlayer[];
  settings: Settings;
  /** Server clock injected for determinism/testability. */
  now: () => number;
}

export interface GameEngine {
  /** Called when the VIP starts the game. Returns the first in-game phase. */
  start(ctx: GameContext): EnginePhase;
  /** Public payload for the host screen for the current phase. */
  publicPhaseData(): unknown;
  /** Private payload for one player (their prompt, their lock state, …). */
  privatePhaseData(playerId: string): unknown;
  /** Handle a validated game action from a player. Returns next phase if it changed. */
  onAction(playerId: string, payload: unknown): EnginePhase | null;
  /** Called when the current phase's timer elapses. Returns next phase if it changed. */
  onTimeout(): EnginePhase | null;
  /** True once the game has reached its terminal state. */
  isOver(): boolean;
}
