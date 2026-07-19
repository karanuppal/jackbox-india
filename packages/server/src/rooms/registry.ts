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
  private readonly hostGraceMs: number;
  private readonly maxRooms: number;

  constructor(
    createEngine: CreateEngine,
    opts: { now?: () => number; ttlMs?: number; emptyGraceMs?: number; hostGraceMs?: number; maxRooms?: number } = {},
  ) {
    this.createEngine = createEngine;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? ROOM_CODE_TTL_MS;
    // Grace window before an all-disconnected room is reclaimed. Holds seats
    // across brief network drops so players can reconnect (PLAN.md §4.2).
    this.emptyGraceMs = opts.emptyGraceMs ?? 5 * 60 * 1000;
    // Grace window before a host-absent room is torn down (§4.2, QA-M1-4).
    this.hostGraceMs = opts.hostGraceMs ?? 5 * 60 * 1000;
    // Global room ceiling (SEC-M1-1): reject creation past this.
    this.maxRooms = opts.maxRooms ?? 20_000;
  }

  atCapacity(): boolean {
    return this.rooms.size >= this.maxRooms;
  }

  /** Create a room, or null if the global ceiling is reached (SEC-M1-1). */
  create(): Room | null {
    if (this.atCapacity()) return null;
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
    const hostCutoff = t - this.hostGraceMs;
    for (const [code, room] of this.rooms) {
      const emptySince = room.getEmptySince();
      const hostGoneSince = room.getHostGoneSince();
      const expired = room.createdAt < ttlCutoff;
      const abandoned = emptySince !== null && emptySince < graceCutoff;
      // A room whose host screen has been gone past the grace window is torn
      // down even if a player still lingers — the game can't resume without it.
      const hostGone = hostGoneSince !== null && hostGoneSince < hostCutoff;
      if (expired || abandoned || hostGone) {
        this.rooms.delete(code);
        removed += 1;
      }
    }
    return removed;
  }
}
