import {
  KAMRA_TIMERS,
  MINIGAME_KINDS,
  SOLO_MINIGAMES,
  VOTING_MINIGAMES,
  type KamraPublicPhase,
  type KsAction,
  type MinigameKind,
} from "@tamasha/shared";
import type { FloorInit, Minigame, MinigameDeps } from "./minigame.js";
import {
  Dhokha,
  GandaChitra,
  HisaabKitaab,
  SabseGhatiyaJawaab,
  SpellingShelling,
  TaashKePatte,
  Yaaddasht,
  ZeharWaliChai,
} from "./games.js";

export type KamraSubPhase = "intro" | "play" | "vote" | "result";

export type KamraTimerOverrides = Partial<Record<keyof typeof KAMRA_TIMERS, number>>;

/** Content + timing knobs the engine passes down (defaults built in). */
export interface KamraOptions {
  timers?: KamraTimerOverrides;
  /** Content pools (M5 fills these from /content); one is picked per visit. */
  spellingWords?: string[];
  worstPrompts?: string[];
  drawPrompts?: string[];
  /** §3.4's K5/K6 constraint counts LIVING voters only, even though ghosts
   *  also get to vote (QA-M3-12). Defaults to voterIds.length. */
  livingVoterCount?: number;
}

function pickFrom(pool: string[] | undefined, rand: () => number): string | undefined {
  if (pool === undefined || pool.length === 0) return undefined;
  return pool[Math.floor(rand() * pool.length)];
}

function makeMinigame(
  kind: MinigameKind,
  floor: FloorInit[],
  deps: MinigameDeps,
  opts: KamraOptions,
): Minigame {
  switch (kind) {
    case "hisaabKitaab":
      return new HisaabKitaab(floor, deps);
    case "yaaddasht":
      return new Yaaddasht(floor, deps);
    case "taashKePatte":
      return new TaashKePatte(floor, deps);
    case "spellingShelling": {
      const word = pickFrom(opts.spellingWords, deps.rand);
      return word !== undefined ? new SpellingShelling(floor, deps, word) : new SpellingShelling(floor, deps);
    }
    case "sabseGhatiyaJawaab": {
      const p = pickFrom(opts.worstPrompts, deps.rand);
      return p !== undefined ? new SabseGhatiyaJawaab(floor, deps, p) : new SabseGhatiyaJawaab(floor, deps);
    }
    case "gandaChitra": {
      const p = pickFrom(opts.drawPrompts, deps.rand);
      return p !== undefined ? new GandaChitra(floor, deps, p) : new GandaChitra(floor, deps);
    }
    case "zeharWaliChai":
      return new ZeharWaliChai(floor, deps);
    case "dhokha":
      return new Dhokha(floor, deps);
  }
}

/**
 * Runs one Khooni Kamra visit (PLAN.md §3.4): pick a minigame (respecting
 * voting constraints and least-recently-used to avoid repeats), run its
 * intro → play → [vote] → result phases, and yield the deaths. `seen` is
 * shared across visits within a game so minigames don't repeat until all used.
 */
export class KamraCoordinator {
  readonly game: Minigame;
  private sub: KamraSubPhase = "intro";
  private readonly deps: MinigameDeps;
  private readonly voterIds: Set<string>;
  private readonly voted = new Set<string>();
  private readonly t: Record<keyof typeof KAMRA_TIMERS, number>;
  private deaths: string[] = [];

  constructor(
    floor: FloorInit[],
    voterIds: string[],
    seen: Set<MinigameKind>,
    deps: MinigameDeps,
    opts: KamraOptions = {},
  ) {
    this.deps = deps;
    this.voterIds = new Set(voterIds);
    this.t = { ...KAMRA_TIMERS, ...opts.timers };
    const kind = pickMinigame(floor.length, opts.livingVoterCount ?? voterIds.length, seen, deps.rand);
    seen.add(kind);
    this.game = makeMinigame(kind, floor, deps, opts);
  }

  subPhase(): KamraSubPhase {
    return this.sub;
  }

  /** The deadline for the current sub-phase, or null. */
  deadline(now: number): number | null {
    switch (this.sub) {
      case "intro":
        return now + this.t.introMs;
      case "play":
        return now + this.t.playMs;
      case "vote":
        return now + this.t.voteMs;
      case "result":
        return now + this.t.resultMs;
    }
  }

  /** Advance on timer expiry. Returns true if the visit is finished (result done). */
  onTimeout(): boolean {
    switch (this.sub) {
      case "intro":
        this.sub = "play";
        // Memorize windows (K2/K3) anchor on the real play start (SEC-M3-3).
        this.game.beginPlay(this.deps.now());
        return false;
      case "play":
        // Some games (math, drawing) end only on the timer — mark all seats
        // done / auto-submit drafts.
        if ("finish" in this.game && typeof (this.game as { finish: () => void }).finish === "function") {
          (this.game as { finish: () => void }).finish();
        }
        return this.afterPlay();
      case "vote":
        this.deaths = this.game.resolveDeaths();
        this.sub = "result";
        return false;
      case "result":
        return true;
    }
  }

  /** A player disconnected mid-visit: forfeit their seat (floor) or drop them
   *  from the electorate (vote) so the room never idles a full timer on an
   *  empty chair (QA-M3-9). Returns true if the sub-phase advanced. */
  onPlayerLeft(playerId: string): boolean {
    if (this.sub === "play" && this.isFloor(playerId)) {
      this.game.forfeit(playerId);
      if (this.game.allDone()) {
        this.afterPlay();
        return true;
      }
      return false;
    }
    if (this.sub === "vote" && this.voterIds.has(playerId) && !this.voted.has(playerId)) {
      this.voterIds.delete(playerId);
      return this.maybeCloseVote();
    }
    return false;
  }

  /** Every remaining voter has voted → close the polls early (QA-M3-9). */
  private maybeCloseVote(): boolean {
    if (this.sub !== "vote") return false;
    if (this.voterIds.size === 0 || [...this.voterIds].every((v) => this.voted.has(v))) {
      this.deaths = this.game.resolveDeaths();
      this.sub = "result";
      return true;
    }
    return false;
  }

  private afterPlay(): boolean {
    if (this.game.needsVote && this.voterIds.size > 0) {
      this.sub = "vote";
      return false;
    }
    this.deaths = this.game.resolveDeaths();
    this.sub = "result";
    return false;
  }

  /** A floor player's minigame input, or a voter's vote. Returns true if state advanced. */
  onInput(playerId: string, action: KsAction): boolean {
    if (this.sub === "play" && this.isFloor(playerId)) {
      const changed = this.game.onInput(playerId, action);
      // All floor players locked in early → resolve the play phase.
      if (changed && this.game.allDone()) return this.afterPlayEarly();
      return changed;
    }
    if (this.sub === "vote" && action.type === "kmVote" && this.voterIds.has(playerId)) {
      this.game.onVote(playerId, action.targetId);
      this.voted.add(playerId);
      this.maybeCloseVote(); // all polls in → result early (QA-M3-9)
      return true;
    }
    return false;
  }

  private afterPlayEarly(): boolean {
    // Returning here changes phase; the engine re-reads deadline/subphase.
    this.afterPlay();
    return true;
  }

  private isFloor(playerId: string): boolean {
    return this.game.floorPublic().some((f) => f.playerId === playerId);
  }

  /** VIP censor of a floor player's submission (§4.3). Vote sub-phase only
   *  (SEC-M3-5) and never your own entry (QA-M3-3). */
  censor(callerId: string, targetId: string): boolean {
    if (this.sub !== "vote") return false;
    if (callerId === targetId) return false;
    const g = this.game as { censor?: (id: string) => void };
    if (typeof g.censor === "function") {
      g.censor(targetId);
      return true;
    }
    return false;
  }

  getDeaths(): string[] {
    return this.deaths;
  }
  /** Money earned inside the minigame (§3.7), applied by the engine. */
  getPayouts(): { playerId: string; amount: number }[] {
    return this.game.payouts();
  }
  isFinished(): boolean {
    return this.sub === "result";
  }

  publicPhase(now: number): KamraPublicPhase {
    void now;
    const g = this.game;
    switch (this.sub) {
      case "intro":
        return { kind: "kamraIntro", minigame: g.kind, title: g.title, rules: g.rules, floor: g.floorPublic(), vo: introVo(g.kind) };
      case "play":
        return { kind: "kamraPlay", minigame: g.kind, floor: g.floorPublic(), prompt: g.prompt(), vo: "Khelo… waqt kam hai." };
      case "vote":
        return { kind: "kamraVote", minigame: g.kind, entries: g.voteEntries(), vo: "Sabse ghatiya kaunsa? Vote karo." };
      case "result":
        return {
          kind: "kamraResult",
          minigame: g.kind,
          deaths: this.deaths,
          survivors: g.floorPublic().map((f) => f.playerId).filter((id) => !this.deaths.includes(id)),
          vo: "Faisla ho gaya.",
        };
    }
  }

  privateFor(playerId: string): { onFloor: boolean; data: unknown; done: boolean } {
    const onFloor = this.isFloor(playerId);
    const floor = this.game.floorPublic().find((f) => f.playerId === playerId);
    return { onFloor, data: onFloor ? this.game.privateFor(playerId) : null, done: floor?.done ?? false };
  }
}

/** Least-recently-used minigame selection respecting voting constraints and
 *  the §3.4 solo rule (a lone floor player gets luck/skill games only). */
export function pickMinigame(
  floorSize: number,
  voterCount: number,
  seen: Set<MinigameKind>,
  rand: () => number,
): MinigameKind {
  const votingOk = floorSize >= 2 && voterCount >= 1;
  const base =
    floorSize === 1
      ? MINIGAME_KINDS.filter((k) => SOLO_MINIGAMES.includes(k))
      : MINIGAME_KINDS.filter((k) => votingOk || !VOTING_MINIGAMES.includes(k));
  let pool = base;
  const fresh = pool.filter((k) => !seen.has(k));
  if (fresh.length > 0) pool = fresh; // prefer unseen until all used
  if (pool.length === 0) pool = [...base]; // all seen → allow repeats within the legal pool
  return pool[Math.floor(rand() * pool.length)]!;
}

function introVo(kind: MinigameKind): string {
  const lines: Record<MinigameKind, string> = {
    hisaabKitaab: "Thoda hisaab-kitaab ho jaaye? Sabse kamzor dimaag… yahin rahega.",
    yaaddasht: "Yaaddasht test. Bhoolne walon ke liye… bura hoga.",
    taashKePatte: "Patte dhyaan se dekho. Dhokha yaad rakhta hai.",
    spellingShelling: "Spelling. Padhaai kaam aayegi… ya nahi.",
    sabseGhatiyaJawaab: "Sabse ghatiya jawab dene wala… mera favourite ban jaayega.",
    gandaChitra: "Banao kuch. Sabse ganda chitra… deewar par tangega.",
    zeharWaliChai: "Chai peeni hai? Ek glass mein thoda extra pyaar hai.",
    dhokha: "Ab dekhte hain kaun kiska hai. Dhokha… ya wafaadaari?",
  };
  return lines[kind];
}
