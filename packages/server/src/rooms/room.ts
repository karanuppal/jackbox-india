import { randomUUID } from "node:crypto";
import {
  ACTION_ROLE,
  MAX_AUDIENCE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  sanitizeName,
  toPublicSettings,
  defaultSettings,
  type ClientAction,
  type PlayerPublic,
  type PrivateView,
  type Phase,
  type Role,
  type RoomPublicState,
  type Settings,
  type ServerErrorCode,
} from "@tamasha/shared";
import type { ActionMeta, GameEngine, GamePlayer } from "../game/engine.js";
import { safeEqual } from "../net/ipLimits.js";

export interface Player {
  id: string;
  sessionToken: string;
  name: string;
  avatar: number;
  role: Extract<Role, "player" | "audience">;
  vip: boolean;
  alive: boolean;
  money: number;
  connected: boolean;
  answered: boolean;
  joinOrder: number;
}

export interface JoinResult {
  ok: true;
  playerId: string | null; // null for host screen
  sessionToken: string;
  role: Role;
}
export interface JoinError {
  ok: false;
  code: ServerErrorCode;
}

export type CreateEngine = () => GameEngine;

/**
 * One live room. Authoritative for all state; connections are attached
 * separately by the ws hub, which calls into these methods and then reads
 * publicState()/privateView() to push snapshots.
 */
export class Room {
  readonly code: string;
  readonly createdAt: number;
  readonly hostToken: string;
  private settings: Settings;
  private phase: Phase = "lobby";
  private paused = false;
  private players = new Map<string, Player>();
  private hostConnected = false;
  private joinCounter = 0;
  private engine: GameEngine | null = null;
  private readonly createEngine: CreateEngine;
  private readonly now: () => number;
  private deadline: number | null = null;
  // Timestamp the room last became fully disconnected (null while occupied).
  // The registry evicts rooms empty past a grace window, so a brief all-drop
  // (network blip) does not destroy held seats (PLAN.md §4.2).
  private emptySince: number | null;
  // Epoch-ms the host disconnected; drives host-absence teardown (§4.2, QA-M1-4).
  private hostGoneSince: number | null = null;
  // Milliseconds left on the countdown when the game was paused (§4.3).
  private pausedRemaining: number | null = null;

  constructor(code: string, createEngine: CreateEngine, now: () => number = Date.now) {
    this.code = code;
    this.createEngine = createEngine;
    this.now = now;
    this.createdAt = now();
    this.hostToken = randomUUID();
    this.settings = defaultSettings();
    this.emptySince = this.createdAt; // created but nobody connected yet
  }

  getPhase(): Phase {
    return this.phase;
  }
  isPaused(): boolean {
    return this.paused;
  }
  getSettings(): Settings {
    return this.settings;
  }
  passwordRequired(): boolean {
    return this.settings.password !== null && this.settings.password.length > 0;
  }
  /** Active-player slots still open AND game not yet started. */
  joinable(): boolean {
    return this.phase === "lobby" && this.activePlayers().length < MAX_PLAYERS;
  }

  private activePlayers(): Player[] {
    return [...this.players.values()]
      .filter((p) => p.role === "player")
      .sort((a, b) => a.joinOrder - b.joinOrder);
  }
  private audience(): Player[] {
    return [...this.players.values()].filter((p) => p.role === "audience");
  }

  // --- host screen -----------------------------------------------------------
  connectHost(sessionToken: string): JoinResult | JoinError {
    if (!safeEqual(sessionToken, this.hostToken)) return { ok: false, code: "NOT_ALLOWED" };
    this.hostConnected = true;
    this.hostGoneSince = null;
    this.recomputeEmpty();
    return { ok: true, playerId: null, sessionToken: this.hostToken, role: "host" };
  }
  disconnectHost(): void {
    this.hostConnected = false;
    this.hostGoneSince = this.now();
    // Host drop pauses the game for everyone (grace before teardown, §4.2).
    if (this.phase !== "lobby" && this.phase !== "gameOver" && this.phase !== "postGame") {
      this.paused = true;
    }
    this.recomputeEmpty();
  }
  /** Epoch-ms the host screen last disconnected (null while connected). §4.2. */
  getHostGoneSince(): number | null {
    return this.hostGoneSince;
  }
  isHostConnected(): boolean {
    return this.hostConnected;
  }

  private recomputeEmpty(): void {
    this.emptySince = this.isEmpty() ? (this.emptySince ?? this.now()) : null;
  }
  getEmptySince(): number | null {
    return this.emptySince;
  }

  // --- players / audience ----------------------------------------------------
  join(opts: { name?: string; sessionToken?: string; password?: string }): JoinResult | JoinError {
    // Reconnect path: known token restores the exact seat.
    if (opts.sessionToken !== undefined) {
      const existing = [...this.players.values()].find((p) => safeEqual(p.sessionToken, opts.sessionToken!));
      if (existing !== undefined) {
        existing.connected = true;
        this.reassignVipIfNeeded();
        this.recomputeEmpty();
        return { ok: true, playerId: existing.id, sessionToken: existing.sessionToken, role: existing.role };
      }
      // Unknown token → fall through and treat as a fresh join.
    }

    if (this.passwordRequired() && !safeEqual(opts.password ?? "", this.settings.password ?? "")) {
      return { ok: false, code: "BAD_PASSWORD" };
    }

    const cleanName = sanitizeName(opts.name ?? "");
    if (cleanName === null) return { ok: false, code: "BAD_NAME" };

    // Name-based reconnect (UT-M1-4): if a DISCONNECTED player holds this exact
    // name, reclaim that seat — covers cleared storage / a different device,
    // matching Jackbox's "same code + same name" rejoin.
    const stale = [...this.players.values()].find(
      (p) => !p.connected && p.name.toLowerCase() === cleanName.toLowerCase(),
    );
    if (stale !== undefined) {
      // Mint a FRESH session token on name-reclaim and invalidate the old one
      // (Security INFO-1): if the prior holder returns, their stale token no
      // longer matches, so only the newest name-reclaimer holds the seat.
      stale.sessionToken = randomUUID();
      stale.connected = true;
      this.reassignVipIfNeeded();
      this.recomputeEmpty();
      return { ok: true, playerId: stale.id, sessionToken: stale.sessionToken, role: stale.role };
    }

    const asPlayer = this.joinable();
    if (!asPlayer) {
      if (!this.settings.audienceEnabled) return { ok: false, code: "ROOM_FULL" };
      if (this.audience().length >= MAX_AUDIENCE) return { ok: false, code: "ROOM_FULL" };
    }

    const id = randomUUID();
    const sessionToken = randomUUID();
    const player: Player = {
      id,
      sessionToken,
      name: this.uniqueName(cleanName),
      avatar: asPlayer ? this.nextAvatar() : -1, // audience needs no avatar (QA-M1-12)
      role: asPlayer ? "player" : "audience",
      vip: asPlayer && this.activePlayers().length === 0,
      alive: true,
      money: 0,
      connected: true,
      answered: false,
      joinOrder: this.joinCounter++,
    };
    this.players.set(id, player);
    this.reassignVipIfNeeded();
    this.recomputeEmpty();
    return { ok: true, playerId: id, sessionToken, role: player.role };
  }

  markDisconnected(playerId: string): void {
    const p = this.players.get(playerId);
    if (p !== undefined) p.connected = false;
    this.reassignVipIfNeeded();
    this.recomputeEmpty();
  }

  /**
   * If the VIP is gone (disconnected) and another connected active player
   * exists, promote the earliest-joined connected player (QA-M1-3). Prevents a
   * lobby soft-lock where nobody can press the VIP-only start button.
   */
  private reassignVipIfNeeded(): void {
    const players = this.activePlayers();
    const currentVip = players.find((p) => p.vip);
    if (currentVip !== undefined && currentVip.connected) return;
    const heir = players.find((p) => p.connected);
    if (heir === undefined) return; // nobody connected; keep flag until someone returns
    for (const p of players) p.vip = false;
    heir.vip = true;
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const candidate = `${name} ${n}`.slice(0, MAX_NAME_LENGTH + 3);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${name} ${randomUUID().slice(0, 3)}`;
  }
  private nextAvatar(): number {
    const used = new Set([...this.players.values()].filter((p) => p.role === "player").map((p) => p.avatar));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return this.joinCounter % MAX_PLAYERS;
  }

  private isVip(playerId: string | null): boolean {
    if (playerId === null) return false;
    const p = this.players.get(playerId);
    return p !== undefined && p.vip;
  }

  // --- actions ---------------------------------------------------------------
  /**
   * Apply a platform action from a connection. `playerId` is null for the host
   * screen. Returns an error code if rejected, otherwise null (state changed).
   */
  applyAction(playerId: string | null, action: ClientAction): ServerErrorCode | null {
    const required = ACTION_ROLE[action.action] ?? "any";
    if (required === "hostScreen" && playerId !== null) return "NOT_ALLOWED";
    if (required === "vip" && !this.isVip(playerId)) return "NOT_ALLOWED";

    switch (action.action) {
      case "startGame":
        return this.startGame();
      case "skipTutorial":
        if (this.phase !== "tutorial") return "NOT_ALLOWED";
        return this.advanceFromTutorial();
      case "restart":
        if (this.phase !== "gameOver" && this.phase !== "postGame") return "NOT_ALLOWED";
        this.resetToLobby();
        return null;
      case "updateSettings": {
        if (this.phase !== "lobby") return "NOT_ALLOWED";
        // Merge only keys the client actually provided (undefined would
        // clobber under exactOptionalPropertyTypes).
        const patch = action.settings;
        const merged: Settings = { ...this.settings };
        for (const key of Object.keys(patch) as (keyof Settings)[]) {
          const value = patch[key];
          if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
        }
        this.settings = merged;
        return null;
      }
      case "pause":
        if (!this.paused) {
          this.paused = true;
          // Freeze the countdown: remember what was left (§4.3 pause).
          this.pausedRemaining = this.deadline !== null ? Math.max(0, this.deadline - this.now()) : null;
        }
        return null;
      case "resume":
        if (this.paused) {
          this.paused = false;
          if (this.pausedRemaining !== null) this.deadline = this.now() + this.pausedRemaining;
          this.pausedRemaining = null;
        }
        return null;
      case "game":
        // Paused freezes all game input for everyone (§4.3, QA-M1-10).
        if (this.paused) return "NOT_ALLOWED";
        return this.applyGameAction(playerId, action.payload);
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
        return "BAD_MESSAGE";
      }
    }
  }

  private startGame(): ServerErrorCode | null {
    if (this.phase !== "lobby") return "NOT_ALLOWED";
    if (this.activePlayers().length < 1) return "NOT_ALLOWED";
    this.engine = this.createEngine();
    const gamePlayers: GamePlayer[] = this.activePlayers().map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
    }));
    const next = this.engine.start({ players: gamePlayers, settings: this.settings, now: this.now });
    this.phase = next.phase as Phase;
    this.deadline = next.deadline;
    return null;
  }

  private advanceFromTutorial(): ServerErrorCode | null {
    if (this.engine === null) return "NOT_ALLOWED";
    const next = this.engine.onTimeout();
    if (next !== null) {
      this.phase = next.phase as Phase;
      this.deadline = next.deadline;
    }
    return null;
  }

  private applyGameAction(playerId: string | null, payload: unknown): ServerErrorCode | null {
    if (this.engine === null || playerId === null) return "NOT_ALLOWED";
    const p = this.players.get(playerId);
    if (p === undefined) return "NOT_ALLOWED";
    const meta: ActionMeta = { role: p.role, active: p.role === "player" && p.alive };
    const next = this.engine.onAction(playerId, payload, meta);
    if (next !== null) {
      this.phase = next.phase as Phase;
      this.deadline = next.deadline;
    }
    return null;
  }

  private resetToLobby(): void {
    this.phase = "lobby";
    this.paused = false;
    this.deadline = null;
    this.engine = null;
    for (const p of this.players.values()) {
      p.alive = true;
      p.money = 0;
      p.answered = false;
    }
  }

  /**
   * The current phase's deadline has been reached — advance the engine
   * (§3.3 auto-advance of timed phases). No-op when untimed, paused, or the
   * deadline is still in the future. Returns true if state changed.
   */
  handleTimeout(): boolean {
    if (this.engine === null || this.paused) return false;
    if (this.deadline === null || this.now() < this.deadline) return false;
    const next = this.engine.onTimeout();
    if (next === null) return false;
    this.phase = next.phase as Phase;
    this.deadline = next.deadline;
    return true;
  }

  getDeadline(): number | null {
    return this.deadline;
  }

  // --- snapshots -------------------------------------------------------------
  private playerPublic(p: Player): PlayerPublic {
    // During an active game the engine owns money/alive/answered (§3.5).
    const gs = this.engine !== null ? this.engine.playerState(p.id) : null;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      vip: p.vip,
      alive: gs !== null ? gs.alive : p.alive,
      money: gs !== null ? gs.money : p.money,
      connected: p.connected,
      answered: gs !== null ? gs.answered : p.answered,
    };
  }

  publicState(): RoomPublicState {
    const progress = this.engine !== null ? this.engine.progress() : { number: 0, total: 0 };
    return {
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      settings: toPublicSettings(this.settings),
      players: this.activePlayers().map((p) => this.playerPublic(p)),
      audienceCount: this.audience().length,
      questionNumber: progress.number,
      questionTotal: progress.total,
      deadline: this.deadline,
      phaseData: this.engine !== null ? this.engine.publicPhaseData() : null,
    };
  }

  privateView(playerId: string | null, role: Role): PrivateView {
    const p = playerId !== null ? this.players.get(playerId) : undefined;
    return {
      you: p !== undefined ? this.playerPublic(p) : null,
      role,
      phaseData:
        this.engine !== null && playerId !== null ? this.engine.privatePhaseData(playerId) : null,
    };
  }

  /** No live connections and past its useful life → registry can evict. */
  isEmpty(): boolean {
    return !this.hostConnected && [...this.players.values()].every((p) => !p.connected);
  }
}
