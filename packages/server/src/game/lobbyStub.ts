import type { EnginePhase, GameContext, GameEngine } from "./engine.js";

/**
 * M1 placeholder engine. The platform's job in M1 is rooms/lobby/reconnect;
 * the real Khooni Sawaal trivia engine replaces this in M2. On start it moves
 * the room into the tutorial phase and holds there. Defined so the room's
 * game handoff is exercised end-to-end before M2.
 */
export class LobbyStubEngine implements GameEngine {
  private started = false;

  start(_ctx: GameContext): EnginePhase {
    this.started = true;
    return { phase: "tutorial", deadline: null };
  }
  publicPhaseData(): unknown {
    return { stub: true, started: this.started };
  }
  privatePhaseData(_playerId: string): unknown {
    return { stub: true };
  }
  onAction(_playerId: string, _payload: unknown, _meta: import("./engine.js").ActionMeta): EnginePhase | null {
    return null;
  }
  onTimeout(): EnginePhase | null {
    return null;
  }
  playerState(): { alive: boolean; money: number; answered: boolean } | null {
    return null;
  }
  progress(): { number: number; total: number } {
    return { number: 0, total: 0 };
  }
  isOver(): boolean {
    return false;
  }
}

export const createLobbyStubEngine = (): GameEngine => new LobbyStubEngine();
