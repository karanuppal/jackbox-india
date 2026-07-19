import { ROOM_CODE_TTL_MS } from "@tamasha/shared";
import { Room, type CreateEngine } from "./room.js";
import { generateUniqueCode } from "./roomCode.js";

/**
 * In-memory room registry. Rooms are isolated and small; one process holds
 * many. Expired rooms (past TTL) and empty rooms (no live connections) are
 * swept out (PLAN.md §4.1/§4.2).
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private readonly createEngine: CreateEngine;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly emptyGraceMs: number;

  constructor(
    createEngine: CreateEngine,
    opts: { now?: () => number; ttlMs?: number; emptyGraceMs?: number } = {},
  ) {
    this.createEngine = createEngine;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? ROOM_CODE_TTL_MS;
    // Grace window before an all-disconnected room is reclaimed. Holds seats
    // across brief network drops so players can reconnect (PLAN.md §4.2).
    this.emptyGraceMs = opts.emptyGraceMs ?? 5 * 60 * 1000;
  }

  create(): Room {
    const code = generateUniqueCode((c) => this.rooms.has(c));
    const room = new Room(code, this.createEngine, this.now);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  delete(code: string): void {
    this.rooms.delete(code);
  }

  size(): number {
    return this.rooms.size;
  }

  /**
   * Remove rooms past their TTL, or that have been fully disconnected for
   * longer than the grace window. Returns count removed.
   */
  sweep(): number {
    let removed = 0;
    const t = this.now();
    const ttlCutoff = t - this.ttlMs;
    const graceCutoff = t - this.emptyGraceMs;
    for (const [code, room] of this.rooms) {
      const emptySince = room.getEmptySince();
      const expired = room.createdAt < ttlCutoff;
      const abandoned = emptySince !== null && emptySince < graceCutoff;
      if (expired || abandoned) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }
}
