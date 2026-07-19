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

export interface ActionMeta {
  role: "player" | "audience";
  /** True if this is an active (alive) player, not a ghost/audience. */
  active: boolean;
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
  /**
   * Handle a validated game action. `meta` carries the caller's role/liveness
   * so the engine can authorize player-vs-audience input without re-deriving it
   * (SEC-M1-5). Returns the next phase if it changed.
   */
  onAction(playerId: string, payload: unknown, meta: ActionMeta): EnginePhase | null;
  /** Called when the current phase's timer elapses. Returns next phase if it changed. */
  onTimeout(): EnginePhase | null;
  /**
   * A player disconnected. The engine forfeits their pending input (§4.2:
   * disconnected inputs default to no-answer/wrong) so an untimed phase can
   * still resolve. Returns the next phase if it changed.
   */
  onPlayerLeft(playerId: string): EnginePhase | null;
  /**
   * Per-player game state the Room folds into its public snapshot (money,
   * alive, answered). Returns null if the engine doesn't track this player
   * (e.g. audience) — the Room then uses defaults.
   */
  playerState(playerId: string): { alive: boolean; money: number; answered: boolean } | null;
  /** Round progress for the host screen ({number, total}); zeros outside rounds. */
  progress(): { number: number; total: number };
  /** True once the game has reached its terminal state. */
  isOver(): boolean;
}
