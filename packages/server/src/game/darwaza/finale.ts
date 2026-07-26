import {
  AUDIENCE_RUNNER_ID,
  FINALE_BARRIER,
  FINALE_DARKNESS_ADVANCE_MAX,
  FINALE_DARKNESS_ADVANCE_MIN,
  FINALE_DARKNESS_DELAY,
  FINALE_DARKNESS_DELAY_SOLO,
  FINALE_DARKNESS_START,
  FINALE_GHOST_HEADSTARTS,
  FINALE_GHOST_PACK,
  FINALE_LIVING_OPTIONS,
  FINALE_GHOST_OPTIONS,
  FINALE_START_LIVING,
  FINALE_TIMERS,
  fjActionSchema,
  type FinaleCategory,
  type FinaleEvent,
  type FinalePrivate,
  type FinalePublic,
  type FinaleRunnerPublic,
} from "@tamasha/shared";
import { pickDistinct } from "../kamra/games.js";

// Mishra Ji's finale lines (subtitles now; VO audio in M6). Original writing.
const VO = {
  intro:
    "Subah hone wali hai. Aakhri Darwaza khula hai — bhaago! Zinda ho toh zinda hi nikalna… aur peeche mat dekhna.",
  judge: "Jo sahi lage, chuno. Waqt sirf barah second.",
  resolve: "Dekhte hain kaun kitna aage badha…",
  steal: "Arre! Shareer badal gaya!",
  darkness: "Andhera aa raha hai… tez chalo.",
  escape: "Darwaza toot gaya! Koi nikal gaya!",
  nobody: "Koi nahi nikla. Manzil Mahal ne sab rakh liya.",
} as const;

export interface FinaleEntrant {
  id: string;
  name: string;
  money: number;
}

export interface FinaleOptions {
  rand?: () => number;
  timers?: Partial<Record<keyof typeof FINALE_TIMERS, number>>;
  /** Include the collective audience runner (§3.6). */
  audience?: boolean;
}

interface Runner {
  id: string;
  name: string;
  kind: "living" | "ghost" | "audience";
  distance: number;
  eliminated: boolean;
  lastMove: number;
  money: number;
}

export type FinaleSubPhase = "intro" | "judge" | "resolve" | "over";

/**
 * The Aakhri Darwaza escape finale (PLAN.md §3.6). One living player races
 * ghosts (and optionally the audience-as-a-ghost) down a linear track to the
 * exit: judged categories move you, ghosts steal the body on contact, a wall
 * of darkness sweeps the track, and the door barrier demands a perfect turn.
 */
export class AakhriDarwazaFinale {
  private readonly runners: Runner[] = [];
  private readonly categories: FinaleCategory[];
  private readonly rand: () => number;
  private readonly t: Record<keyof typeof FINALE_TIMERS, number>;
  private readonly solo: boolean;

  private sub: FinaleSubPhase = "intro";
  private turn = 0; // 1-based once judging starts
  private darkness = FINALE_DARKNESS_START;
  private assignments = new Map<string, number[]>(); // runnerId → option indices
  private selections = new Map<string, number[]>(); // runnerId → locked selection
  /** memberId → their ballot. `key` is the dedupe identity (per-IP, SEC-M4-1):
   *  many sockets from one device collapse to one voice in the majority. */
  private audienceVotes = new Map<string, { selection: number[]; key: string }>();
  private events: FinaleEvent[] = [];
  private finished = false;
  private crownId: string | null = null; // trophy holder once finished
  private escapedFlag = false;
  private audienceEscapedFlag = false;

  constructor(
    living: FinaleEntrant,
    ghosts: FinaleEntrant[],
    categories: FinaleCategory[],
    opts: FinaleOptions = {},
  ) {
    this.rand = opts.rand ?? Math.random;
    this.t = { ...FINALE_TIMERS, ...opts.timers };
    if (categories.length === 0) throw new Error("finale needs at least one category");
    // Shuffle the category order once per finale.
    this.categories = [...categories].sort(() => this.rand() - 0.5);
    this.solo = ghosts.length === 0;

    this.runners.push({
      id: living.id,
      name: living.name,
      kind: "living",
      distance: FINALE_START_LIVING,
      eliminated: false,
      lastMove: 0,
      money: living.money,
    });
    // The 3 richest ghosts get head starts of 3/2/1 ahead of the pack (§3.6).
    const byMoney = [...ghosts].sort((a, b) => b.money - a.money);
    byMoney.forEach((g, i) => {
      const head = i < FINALE_GHOST_HEADSTARTS.length ? FINALE_GHOST_HEADSTARTS[i]! : 0;
      this.runners.push({
        id: g.id,
        name: g.name,
        kind: "ghost",
        distance: FINALE_GHOST_PACK - head,
        eliminated: false,
        lastMove: 0,
        money: g.money,
      });
    });
    if (opts.audience === true) {
      this.runners.push({
        id: AUDIENCE_RUNNER_ID,
        name: "Audience",
        kind: "audience",
        distance: FINALE_GHOST_PACK,
        eliminated: false,
        lastMove: 0,
        money: 0,
      });
    }
  }

  subPhase(): FinaleSubPhase {
    return this.sub;
  }

  deadline(now: number): number | null {
    switch (this.sub) {
      case "intro":
        return now + this.t.introMs;
      case "judge":
        return now + this.t.turnMs; // §3.6: 12s, never extended
      case "resolve":
        return now + this.t.resolveMs;
      case "over":
        return null;
    }
  }

  /** Advance on timer expiry. Returns true once the finale has fully ended. */
  onTimeout(): boolean {
    switch (this.sub) {
      case "intro":
        this.enterJudge();
        return false;
      case "judge":
        this.resolveTurn();
        return false;
      case "resolve":
        if (this.finished) {
          this.sub = "over";
          return true;
        }
        this.enterJudge();
        return false;
      case "over":
        return true;
    }
  }

  private active(): Runner[] {
    return this.runners.filter((r) => !r.eliminated && r.distance > 0);
  }
  private living(): Runner | undefined {
    return this.runners.find((r) => r.kind === "living" && !r.eliminated);
  }

  private category(): FinaleCategory {
    return this.categories[(this.turn - 1) % this.categories.length]!;
  }

  private enterJudge(): void {
    this.turn += 1;
    this.sub = "judge";
    this.assignments.clear();
    this.selections.clear();
    this.audienceVotes.clear();
    this.events = [];
    for (const r of this.runners) r.lastMove = 0;
    const cat = this.category();
    for (const r of this.active()) {
      const n =
        r.kind === "living"
          ? this.solo
            ? FINALE_GHOST_OPTIONS // solo games use 3 options too (§3.6)
            : FINALE_LIVING_OPTIONS
          : FINALE_GHOST_OPTIONS;
      this.assignments.set(r.id, pickDistinct(cat.options.length, n, this.rand).sort((a, b) => a - b));
    }
  }

  /**
   * A judgment from a racing player, or an audience member's vote for the
   * collective audience runner. Returns true if state changed.
   */
  onInput(playerId: string, payload: unknown, isAudienceMember = false, dedupeKey?: string): boolean {
    if (this.sub !== "judge") return false;
    const parsed = fjActionSchema.safeParse(payload);
    if (!parsed.success) return false;
    const action = parsed.data;
    if (action.turn !== this.turn) return false; // stale lock from a prior turn

    if (isAudienceMember) {
      const assigned = this.assignments.get(AUDIENCE_RUNNER_ID);
      if (assigned === undefined) return false;
      this.audienceVotes.set(playerId, {
        selection: action.selection.filter((i) => assigned.includes(i)),
        key: dedupeKey ?? playerId,
      });
      return true; // audience never early-resolves the turn; majority at timeout
    }

    const runner = this.runners.find((r) => r.id === playerId && !r.eliminated && r.distance > 0);
    if (runner === undefined || runner.kind === "audience") return false;
    if (this.selections.has(playerId)) return false; // locked; no takebacks
    const assigned = this.assignments.get(playerId);
    if (assigned === undefined) return false;
    this.selections.set(playerId, action.selection.filter((i) => assigned.includes(i)));
    this.maybeEarlyResolve();
    return true;
  }

  /** All player runners locked → resolve early. With an audience runner racing
   *  the turn always runs its full 12s (their votes trickle in). */
  private maybeEarlyResolve(): void {
    const audienceRacing = this.active().some((r) => r.kind === "audience");
    if (audienceRacing) return;
    const playerRunners = this.active().filter((r) => r.kind !== "audience");
    if (playerRunners.every((r) => this.selections.has(r.id))) this.resolveTurn();
  }

  /** A racing player disconnected — lock an empty judgment so the turn can
   *  resolve early instead of idling all 12s every turn (QA-M4-4). Returns
   *  true if the sub-phase advanced. */
  onPlayerLeft(playerId: string): boolean {
    if (this.sub !== "judge") return false;
    const runner = this.runners.find(
      (r) => r.id === playerId && r.kind !== "audience" && !r.eliminated && r.distance > 0,
    );
    if (runner === undefined || this.selections.has(playerId)) return false;
    this.selections.set(playerId, []); // §3.6/§4.2: absent = empty judgment
    const before = this.sub;
    this.maybeEarlyResolve();
    return (this.sub as FinaleSubPhase) !== before;
  }

  private resolveTurn(): void {
    const cat = this.category();
    this.events = [];

    // Collapse audience votes to a majority selection (§3.6), one voice per
    // dedupe key — the LAST ballot from each key wins (SEC-M4-1).
    const audienceAssigned = this.assignments.get(AUDIENCE_RUNNER_ID);
    if (audienceAssigned !== undefined && this.audienceVotes.size > 0) {
      const byKey = new Map<string, number[]>();
      for (const v of this.audienceVotes.values()) byKey.set(v.key, v.selection);
      const voters = byKey.size;
      const sel: number[] = [];
      for (const idx of audienceAssigned) {
        const votes = [...byKey.values()].filter((v) => v.includes(idx)).length;
        if (votes * 2 > voters) sel.push(idx);
      }
      this.selections.set(AUDIENCE_RUNNER_ID, sel);
    }

    // Movement: 1 space per correct judgment; the barrier blocks an imperfect
    // crossing (§3.6). NO LOCK = NO MOVEMENT (UT-M4-2, TMP behavior, PLAN
    // amendment 2026-07-26): an untouched phone never creeps forward, never
    // "accidentally" steals a body, and can never be barrier-perfect idle.
    for (const r of this.active()) {
      const locked = this.selections.has(r.id);
      if (!locked) {
        r.lastMove = 0;
        continue;
      }
      const assigned = this.assignments.get(r.id) ?? [];
      const sel = new Set(this.selections.get(r.id) ?? []);
      let score = 0;
      for (const idx of assigned) {
        const fits = cat.options[idx]?.fits === true;
        if (fits === sel.has(idx)) score += 1;
      }
      const perfect = assigned.length > 0 && score === assigned.length;
      let next = r.distance - score;
      if (next <= 0) {
        if (perfect) {
          next = 0;
          this.events.push({ type: "escape", id: r.id });
        } else {
          next = Math.max(1, FINALE_BARRIER - 1); // blocked at the door
          this.events.push({ type: "barrier", id: r.id });
        }
      }
      r.lastMove = r.distance - next;
      r.distance = next;
    }

    // Body stealing: a ghost that reaches/passes the living player's space
    // steals the body; closest wins, tied losers get knocked back (§3.6).
    this.applySteals();

    // Darkness sweeps after the grace turns (§3.6).
    const delay = this.solo ? FINALE_DARKNESS_DELAY_SOLO : FINALE_DARKNESS_DELAY;
    if (this.turn > delay) {
      const advance =
        FINALE_DARKNESS_ADVANCE_MIN +
        Math.floor(this.rand() * (FINALE_DARKNESS_ADVANCE_MAX - FINALE_DARKNESS_ADVANCE_MIN + 1)); // 2–3
      this.darkness = Math.max(1, this.darkness - advance);
      for (const r of this.runners) {
        if (!r.eliminated && r.distance > 0 && r.distance >= this.darkness) {
          r.eliminated = true;
          this.events.push({ type: "darkness", id: r.id });
        }
      }
    }

    this.checkEnd();
    this.sub = "resolve";
  }

  private applySteals(): void {
    for (let guard = 0; guard < this.runners.length + 1; guard++) {
      const living = this.living();
      if (living === undefined || living.distance <= 0) return;
      const challengers = this.runners.filter(
        (r) => r.kind === "ghost" && !r.eliminated && r.distance <= living.distance,
      );
      if (challengers.length === 0) return;
      const closest = Math.min(...challengers.map((c) => c.distance));
      const tied = challengers.filter((c) => c.distance === closest);
      const thief = tied[Math.floor(this.rand() * tied.length)]!;
      thief.kind = "living";
      living.kind = "ghost";
      living.distance = FINALE_GHOST_PACK; // back to the pack (§3.6)
      this.events.push({ type: "steal", byId: thief.id, fromId: living.id });
      // Tied losers get knocked back behind the new body.
      for (const loser of tied) {
        if (loser.id !== thief.id) loser.distance = thief.distance + 3;
      }
    }
  }

  private checkEnd(): void {
    const escaped = this.events.filter((e) => e.type === "escape");
    for (const e of escaped) {
      const r = this.runners.find((x) => x.id === e.id)!;
      if (r.kind === "living") {
        // First across while alive wins the whole game, money irrelevant (§3.6).
        this.finished = true;
        this.escapedFlag = true;
        this.crownId = r.id;
        return;
      }
      if (r.kind === "audience") {
        // "The public escapes" gag: the crown goes to the current body holder
        // (TMP2-style; the audience can't take the trophy, §3.6).
        this.finished = true;
        this.audienceEscapedFlag = true;
        const living = this.living();
        this.crownId = living?.id ?? this.richestPlayerId();
        return;
      }
    }
    const living = this.living();
    if (living === undefined) {
      // The body was swallowed by the darkness — nobody escapes; the richest
      // corpse takes the gag crown ("sabse amir laash", §3.6).
      this.finished = true;
      this.crownId = this.richestPlayerId();
      return;
    }
    // If every ghost/audience rival is gone the living player still has to
    // outrun the darkness — the race continues.
  }

  private richestPlayerId(): string | null {
    const players = this.runners.filter((r) => r.id !== AUDIENCE_RUNNER_ID);
    if (players.length === 0) return null;
    return [...players].sort((a, b) => b.money - a.money)[0]!.id;
  }

  isFinished(): boolean {
    return this.finished && (this.sub === "over" || this.sub === "resolve");
  }
  isOverPhase(): boolean {
    return this.sub === "over";
  }
  /** The trophy holder once finished (null only for a degenerate empty race). */
  winnerId(): string | null {
    return this.crownId;
  }
  didEscape(): boolean {
    return this.escapedFlag;
  }
  didAudienceEscape(): boolean {
    return this.audienceEscapedFlag;
  }
  /** The current body holder (for standings while racing). */
  livingId(): string | null {
    return this.living()?.id ?? null;
  }
  currentTurn(): number {
    return this.turn;
  }

  private runnersPublic(): FinaleRunnerPublic[] {
    return this.runners.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      distance: r.distance,
      eliminated: r.eliminated,
      lastMove: r.lastMove,
      // The audience runner shows "locked" once any ballots are in (its
      // selection only materializes at resolve, QA-M4-8).
      locked: r.kind === "audience" ? this.audienceVotes.size > 0 : this.selections.has(r.id),
    }));
  }

  publicPhase(): FinalePublic {
    if (this.sub === "intro") {
      return { kind: "finaleIntro", runners: this.runnersPublic(), vo: VO.intro };
    }
    const escaped = this.events.some((e) => e.type === "escape");
    const stole = this.events.some((e) => e.type === "steal");
    return {
      kind: "finaleTurn",
      sub: this.sub === "judge" ? "judge" : "resolve",
      turn: this.turn,
      categoryTitle: this.category().title,
      runners: this.runnersPublic(),
      darkness: this.darkness,
      events: this.sub === "judge" ? [] : [...this.events],
      vo:
        this.sub === "judge"
          ? VO.judge
          : this.finished
            ? escaped || this.audienceEscapedFlag
              ? VO.escape
              : VO.nobody
            : stole
              ? VO.steal
              : this.turn > (this.solo ? FINALE_DARKNESS_DELAY_SOLO : FINALE_DARKNESS_DELAY)
                ? VO.darkness
                : VO.resolve,
    };
  }

  privateFor(playerId: string, isAudienceMember = false): FinalePrivate {
    const runnerId = isAudienceMember ? AUDIENCE_RUNNER_ID : playerId;
    const runner = this.runners.find((r) => r.id === runnerId && !r.eliminated && r.distance > 0);
    if (runner === undefined || this.sub !== "judge") {
      return { racing: runner !== undefined, options: null, selection: null, locked: false };
    }
    const assigned = this.assignments.get(runnerId) ?? [];
    const cat = this.category();
    const sel = isAudienceMember
      ? this.audienceVotes.get(playerId)?.selection ?? null
      : this.selections.get(runnerId) ?? null;
    return {
      racing: true,
      options: assigned.map((i) => ({ index: i, text: cat.options[i]?.text ?? "?" })),
      selection: sel,
      locked: isAudienceMember ? this.audienceVotes.has(playerId) : this.selections.has(runnerId),
    };
  }
}
