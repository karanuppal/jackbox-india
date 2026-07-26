import {
  applyProfanityFilter,
  censorActionSchema,
  CORRECT_REWARD,
  FINALE_TIMERS,
  KAMRA_TIMERS,
  ksActionSchema,
  QUESTION_BUDGET,
  sanitizeFreeText,
  TIMERS,
  WHEEL_DEATH_SEGMENTS,
  WHEEL_TOTAL_SEGMENTS,
  type FinaleCategory,
  type KsAction,
  type KsPrivatePhase,
  type KsPublicPhase,
  type KsRevealOptionTally,
  type KsStanding,
  type MinigameKind,
  type ProfanityMode,
  type Question,
} from "@tamasha/shared";
import { AakhriDarwazaFinale } from "./darwaza/finale.js";
import type { ActionMeta, EnginePhase, GameContext, GameEngine } from "./engine.js";
import { KamraCoordinator, type KamraOptions } from "./kamra/coordinator.js";

// Sentinel written into a player's answer slot when they forfeit (disconnect
// or auto-skip) — never equals a real option index (0–3), so it always scores
// wrong and lets the all-answered check complete (§4.2, QA-M2-2/SEC-M2-1).
const FORFEIT = -1;

// Mishra Ji's lines (subtitles now; VO audio in M6). Original writing.
const VO = {
  tutorial:
    "Aaiye… Manzil Mahal ke is quiz mein aapka swagat hai. Sahi jawab do — paisa milega. Galat jawab do — aur… khair, dekh lenge. Chaliye shuru karein.",
  allCorrect: "Sab ne sahi jawab diya? Hmm. Aaj kisi ki maut nahi. Agla sawaal.",
  mercy: "Sab ke sab galat! Itni nalayaki par toh main bhi kuch nahi kar sakta. Chalo, maaf kiya… is baar.",
  sentenced: "Galat jawab. Khooni Kamre ka darwaza khul raha hai… andar chaliye.",
  question: "Dhyaan se suniye…",
  gameOver: "Bas, itna hi. Manzil Mahal ne aaj apna hisaab-kitaab kar liya.",
  wheelSpin: "Maut Ka Chakra ghoomta hai… kismat se behas mat karna.",
  wheelDeath: "Chakra ne faisla suna diya. Alvida.",
  wheelLife: "Zinda. Chakra ne aaj maaf kar diya… agli baari tak.",
} as const;

interface KsPlayer {
  id: string;
  name: string;
  alive: boolean;
  money: number;
  answer: number | null; // index for the current question
}

type Phase =
  | "tutorial"
  | "question"
  | "reveal"
  | "khooniKamra"
  | "wheel"
  | "finaleIntro"
  | "finaleTurn"
  | "gameOver";

export interface KsOptions {
  /** Deterministic selection for tests: pick `n` questions from the bank. */
  pickQuestions?: (bank: Question[], n: number, familyFriendly: boolean) => Question[];
  /** Override phase durations (ms) — used by tests for fast timer-driver runs. */
  timers?: Partial<Record<keyof typeof TIMERS, number>>;
  /** Override Khooni Kamra / wheel durations (ms) for tests. */
  kamraTimers?: Partial<Record<keyof typeof KAMRA_TIMERS, number>>;
  /** Deterministic randomness (minigame pick, wheel, content pick). */
  rand?: () => number;
  /** Content pools for the kamra minigames (adult items are filtered out in
   *  family-friendly rooms at game start, §6.4). */
  kamraContent?: {
    spellingWords?: { word: string; adult: boolean }[];
    worstPrompts?: { text: string; adult: boolean }[];
    drawPrompts?: { text: string; adult: boolean }[];
  };
  /** Aakhri Darwaza categories (§3.6). Without any, the game falls back to
   *  ending at gameOver (M2/M3 behavior — used by older tests). */
  finaleCategories?: FinaleCategory[];
  /** Override finale durations (ms) for tests. */
  finaleTimers?: Partial<Record<keyof typeof FINALE_TIMERS, number>>;
}

/**
 * Khooni Sawaal trivia engine (PLAN.md §3.3–§3.4). M3 covers the full loop:
 * tutorial → questions with reveal/scoring/ghosts/mercy → Khooni Kamra
 * killing-floor visits for wrong answers → Maut Ka Chakra wheel when the
 * budget ends with 2+ alive. The Aakhri Darwaza finale (M4) replaces the
 * wheel/attrition ending's direct jump to gameOver.
 */
export class KhooniSawaalEngine implements GameEngine {
  private phase: Phase = "tutorial";
  private players: KsPlayer[] = [];
  private questions: Question[] = [];
  private index = -1; // current question index (0-based); -1 during tutorial
  private now: () => number = () => 0;
  private questionMs: number = TIMERS.questionMs;
  private lastReveal: {
    deaths: string[];
    floor: string[];
    mercy: boolean;
    allCorrect: boolean;
    tally: KsRevealOptionTally[];
  } | null = null;

  // --- Khooni Kamra state (§3.4) ------------------------------------------
  private kamra: KamraCoordinator | null = null;
  private pendingFloor: string[] = [];
  private readonly seenMinigames = new Set<MinigameKind>();
  private kamraOpts: KamraOptions = {};
  private profanityMode: ProfanityMode = "strict";

  // --- Maut Ka Chakra state (§3.3) ----------------------------------------
  private wheelSpinnerId: string | null = null;
  private wheelOutcome: "life" | "death" | null = null;
  /** Spin order: POOREST first (UT-M3-3 — the leaders earned their safety;
   *  the underdogs face the wheel first). Fixed at wheel start. */
  private wheelOrder: string[] = [];

  // --- Aakhri Darwaza state (§3.6, M4) ------------------------------------
  private finale: AakhriDarwazaFinale | null = null;
  private finaleCats: FinaleCategory[] = [];
  private finaleWinner: string | null = null;
  private finaleResult: { escaped: boolean; audienceEscaped: boolean } | null = null;
  private audienceEnabled = false;
  private audienceCount: () => number = () => 0;

  private readonly t: Record<keyof typeof TIMERS, number>;
  private readonly kt: Record<keyof typeof KAMRA_TIMERS, number>;
  private readonly rand: () => number;

  constructor(
    private readonly bank: Question[],
    private readonly opts: KsOptions = {},
  ) {
    this.t = { ...TIMERS, ...opts.timers };
    this.kt = { ...KAMRA_TIMERS, ...opts.kamraTimers };
    this.rand = opts.rand ?? Math.random;
  }

  start(ctx: GameContext): EnginePhase {
    this.now = ctx.now;
    this.players = ctx.players.map((p) => ({ id: p.id, name: p.name, alive: true, money: 0, answer: null }));
    const pick = this.opts.pickQuestions ?? defaultPick;
    this.questions = pick(this.bank, QUESTION_BUDGET, ctx.settings.familyFriendly);
    this.questionMs =
      ctx.settings.timerMode === "extended"
        ? this.t.questionMs * 2
        : ctx.settings.timerMode === "off"
          ? 0 // untimed: the question resolves only when everyone answers (§3.3)
          : this.t.questionMs;
    // Kamra content pools, family-friendly filtered once at start (§6.4).
    const ff = ctx.settings.familyFriendly;
    const kc = this.opts.kamraContent;
    this.profanityMode = ctx.settings.profanityFilter;
    // Kamra play/vote honor the accessibility timer modes by DOUBLING (they
    // stay timed even in "off" mode so a race always resolves; QA-M3-7,
    // PLAN.md amendment 2026-07-26). Test overrides win.
    const slow = ctx.settings.timerMode === "extended" || ctx.settings.timerMode === "off";
    const kamraBase: Partial<Record<keyof typeof KAMRA_TIMERS, number>> = slow
      ? { playMs: this.kt.playMs * 2, voteMs: this.kt.voteMs * 2 }
      : {};
    this.kamraOpts = { timers: { ...kamraBase, ...(this.opts.kamraTimers ?? {}) } };
    const words = kc?.spellingWords?.filter((w) => !ff || !w.adult).map((w) => w.word) ?? [];
    const worst = kc?.worstPrompts?.filter((p) => !ff || !p.adult).map((p) => p.text) ?? [];
    const draw = kc?.drawPrompts?.filter((p) => !ff || !p.adult).map((p) => p.text) ?? [];
    if (words.length > 0) this.kamraOpts.spellingWords = words;
    if (worst.length > 0) this.kamraOpts.worstPrompts = worst;
    if (draw.length > 0) this.kamraOpts.drawPrompts = draw;
    // Finale prerequisites (§3.6): family-friendly filter on categories; the
    // audience runner only exists when the audience is enabled AND present.
    this.finaleCats = (this.opts.finaleCategories ?? []).filter((c) => !ff || !c.adult);
    this.audienceEnabled = ctx.settings.audienceEnabled;
    this.audienceCount = ctx.audienceCount ?? (() => 0);
    // Empty selection guard (QA-M2-4/SEC-M2-3): if a custom picker returned
    // nothing, fall back to the bank — but RESPECT the family-friendly filter
    // in the fallback so we never serve adult content in FF mode (QA-M2-R1).
    // If the (filtered) fallback is still empty, end gracefully.
    if (this.questions.length === 0) {
      const pool = this.bank.filter((q) => !ctx.settings.familyFriendly || !q.adult);
      this.questions = pool.slice(0, QUESTION_BUDGET).sort((a, b) => a.difficulty - b.difficulty);
    }
    if (this.questions.length === 0) {
      this.phase = "gameOver";
      return { phase: "gameOver", deadline: null };
    }
    this.phase = "tutorial";
    if (ctx.settings.skipTutorial) return this.beginQuestion();
    return { phase: "tutorial", deadline: this.now() + this.t.tutorialMs };
  }

  private beginQuestion(): EnginePhase {
    this.index += 1;
    this.lastReveal = null;
    for (const p of this.players) p.answer = null;
    this.phase = "question";
    const timed = this.questionMs > 0;
    return { phase: "question", deadline: timed ? this.now() + this.questionMs : null };
  }

  private currentQuestion(): Question {
    return this.questions[this.index]!;
  }

  onTimeout(): EnginePhase | null {
    switch (this.phase) {
      case "tutorial":
        return this.beginQuestion();
      case "question":
        return this.resolveQuestion();
      case "reveal":
        return this.afterReveal();
      case "khooniKamra":
        return this.kamraTimeout();
      case "wheel":
        return this.wheelTimeout();
      case "finaleIntro":
      case "finaleTurn":
        return this.finaleTimeout();
      case "gameOver":
        return null;
    }
  }

  onAction(playerId: string, payload: unknown, meta: ActionMeta): EnginePhase | null {
    if (this.phase === "khooniKamra") return this.kamraAction(playerId, payload, meta);
    if (this.phase === "finaleIntro" || this.phase === "finaleTurn") {
      return this.finaleAction(playerId, payload, meta);
    }
    if (this.phase !== "question") return null;
    const p = this.players.find((x) => x.id === playerId);
    if (p === undefined) return null; // audience / unknown — ignored
    const idx = parseAnswer(payload, this.currentQuestion().id);
    if (idx === null) return null;
    if (p.answer !== null) return null; // locked; no takebacks
    p.answer = idx;
    return this.maybeResolve();
  }

  /** A player disconnected — forfeit their pending answer so the round can
   *  still resolve in no-timer mode (§4.2, QA-M2-2). Mid-kamra, forfeit their
   *  seat/ballot so the visit can resolve early too (QA-M3-9). */
  onPlayerLeft(playerId: string): EnginePhase | null {
    if (this.phase === "khooniKamra" && this.kamra !== null) {
      const before = this.kamra.subPhase();
      this.kamra.onPlayerLeft(playerId);
      if (this.kamra.subPhase() !== before) {
        return { phase: "khooniKamra", deadline: this.kamra.deadline(this.now()) };
      }
      return null;
    }
    if (this.phase !== "question") return null;
    const p = this.players.find((x) => x.id === playerId);
    if (p === undefined || p.answer !== null) return null;
    p.answer = FORFEIT;
    return this.maybeResolve();
  }

  /** Resolve once everyone (alive + ghost) has locked in. */
  private maybeResolve(): EnginePhase | null {
    if (this.players.every((x) => x.answer !== null)) return this.resolveQuestion();
    return null;
  }

  /** Score the question, sentence wrong-answering living players to the
   *  Khooni Kamra (§3.4), and enter the reveal phase. Nobody dies AT the
   *  reveal anymore — deaths come from the kamra minigame (M3). */
  private resolveQuestion(): EnginePhase {
    const q = this.currentQuestion();
    const correct = q.correct;
    const livingWrong: KsPlayer[] = [];
    for (const p of this.players) {
      const right = p.answer === correct;
      if (right) p.money += CORRECT_REWARD; // ghosts earn too (§3.5)
      else if (p.alive) livingWrong.push(p);
    }
    const livingCount = this.players.filter((p) => p.alive).length;
    const allLivingWrong = livingWrong.length === livingCount && livingCount > 0;
    const allCorrect = livingWrong.length === 0;
    // Mercy: everyone alive was wrong → nobody is sentenced (§3.3).
    this.pendingFloor = allLivingWrong ? [] : livingWrong.map((p) => p.id);
    const counts = [0, 0, 0, 0];
    for (const p of this.players) {
      if (p.answer !== null && p.answer >= 0 && p.answer <= 3) counts[p.answer]! += 1;
    }
    this.lastReveal = {
      deaths: [],
      floor: [...this.pendingFloor],
      mercy: allLivingWrong,
      allCorrect,
      tally: counts.map((count, index) => ({ index, count, correct: index === correct })),
    };
    this.phase = "reveal";
    return { phase: "reveal", deadline: this.now() + this.t.revealMs };
  }

  private afterReveal(): EnginePhase {
    // Sentenced players go to the Khooni Kamra before the game moves on (§3.4).
    if (this.pendingFloor.length > 0) return this.startKamra();
    return this.advanceOrEnd();
  }

  /** Next question, or the endgame (§3.3): one living player in a multiplayer
   *  game → the Aakhri Darwaza immediately; budget exhausted with 2+ alive →
   *  Maut Ka Chakra, then the finale; a solo game plays its full budget and
   *  then races the darkness alone. Without finale categories (older tests)
   *  the game falls back to the M3 endings. */
  private advanceOrEnd(): EnginePhase {
    const alive = this.players.filter((p) => p.alive);
    const canFinale = this.finaleCats.length > 0;
    if (canFinale && this.players.length > 1 && alive.length === 1) return this.startFinale();
    const done = this.index >= this.questions.length - 1;
    if (!done) return this.beginQuestion();
    if (alive.length >= 2) return this.startWheel();
    if (canFinale) return this.startFinale();
    this.phase = "gameOver";
    return { phase: "gameOver", deadline: null };
  }

  // --- Khooni Kamra (§3.4) --------------------------------------------------
  private startKamra(): EnginePhase {
    const floor = this.pendingFloor
      .map((id) => this.players.find((p) => p.id === id))
      .filter((p): p is KsPlayer => p !== undefined)
      .map((p) => ({ playerId: p.id, name: p.name }));
    // Ghosts vote too — "everyone else votes", §3.4/§3.5, QA-M3-12 — but the
    // K5/K6 selection constraint still counts LIVING voters only.
    const offFloor = this.players.filter((p) => !this.pendingFloor.includes(p.id));
    const voters = offFloor.map((p) => p.id);
    const livingVoterCount = offFloor.filter((p) => p.alive).length;
    this.kamra = new KamraCoordinator(
      floor,
      voters,
      this.seenMinigames,
      { now: this.now, rand: this.rand },
      { ...this.kamraOpts, livingVoterCount },
    );
    this.pendingFloor = [];
    this.phase = "khooniKamra";
    return { phase: "khooniKamra", deadline: this.kamra.deadline(this.now()) };
  }

  private kamraTimeout(): EnginePhase | null {
    const k = this.kamra;
    if (k === null) return null;
    const finished = k.onTimeout();
    if (!finished) return { phase: "khooniKamra", deadline: k.deadline(this.now()) };
    return this.applyKamraOutcome();
  }

  /** The visit is over: pay minigame winnings (§3.7), apply deaths, move on.
   *  Amounts may be negative (Dhokha forfeit) — money never drops below 0. */
  private applyKamraOutcome(): EnginePhase {
    const k = this.kamra!;
    for (const { playerId, amount } of k.getPayouts()) {
      const p = this.players.find((x) => x.id === playerId);
      if (p !== undefined) p.money = Math.max(0, p.money + amount);
    }
    for (const id of k.getDeaths()) {
      const p = this.players.find((x) => x.id === id);
      if (p !== undefined) p.alive = false;
    }
    this.kamra = null;
    return this.advanceOrEnd();
  }

  private kamraAction(playerId: string, payload: unknown, meta: ActionMeta): EnginePhase | null {
    const k = this.kamra;
    if (k === null) return null;
    // VIP censor of a floor submission (§4.3) — only the VIP's phone sends it.
    // Vote-phase-only and never their own entry (SEC-M3-5, QA-M3-3).
    const cz = censorActionSchema.safeParse(payload);
    if (cz.success) {
      if (meta.vip !== true) return null;
      k.censor(playerId, cz.data.targetId);
      return null; // no phase change; snapshots rebroadcast regardless
    }
    const parsed = ksActionSchema.safeParse(payload);
    if (!parsed.success || parsed.data.type === "answer") return null;
    const action = this.cleanKamraAction(parsed.data);
    if (action === null) return null;
    const before = k.subPhase();
    const changed = k.onInput(playerId, action);
    if (!changed) return null;
    if (k.subPhase() !== before) {
      // Early advance (all floor players locked in) → new sub-phase deadline.
      return { phase: "khooniKamra", deadline: k.deadline(this.now()) };
    }
    return null;
  }

  /** Normalize player-typed kamra text before it can reach the shared screen:
   *  codepoint hygiene (SEC-M3-1/6) + the §4.4 profanity setting (QA-M3-6 —
   *  strict rejects, lenient masks). */
  private cleanKamraAction(action: KsAction): KsAction | null {
    if (action.type === "kmAnswer") {
      const clean = sanitizeFreeText(action.text, 140);
      if (clean === null) return null;
      const filtered = applyProfanityFilter(clean, this.profanityMode);
      if (filtered.text === null) return null; // strict mode rejects
      return { ...action, text: filtered.text };
    }
    if (action.type === "kmSpell") {
      const clean = sanitizeFreeText(action.word, 24);
      if (clean === null) return null;
      return { ...action, word: clean };
    }
    return action;
  }

  // --- Maut Ka Chakra (§3.3) ------------------------------------------------
  private startWheel(): EnginePhase {
    this.phase = "wheel";
    this.wheelOrder = this.players
      .filter((p) => p.alive)
      .sort((a, b) => a.money - b.money)
      .map((p) => p.id);
    this.wheelSpinnerId = this.wheelOrder[0]!;
    this.wheelOutcome = null;
    return { phase: "wheel", deadline: this.now() + this.kt.wheelSpinMs };
  }

  private wheelTimeout(): EnginePhase | null {
    if (this.wheelSpinnerId === null) return null;
    if (this.wheelOutcome === null) {
      // The spin lands: 5 death segments : 1 life segment (§3.3).
      this.wheelOutcome =
        this.rand() * WHEEL_TOTAL_SEGMENTS < WHEEL_DEATH_SEGMENTS ? "death" : "life";
      return { phase: "wheel", deadline: this.now() + this.kt.wheelLandMs };
    }
    // Apply the landed outcome, then pass the wheel on (or end).
    const spinner = this.players.find((p) => p.id === this.wheelSpinnerId);
    if (spinner !== undefined && this.wheelOutcome === "death") spinner.alive = false;
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      this.wheelSpinnerId = null;
      // One survivor → the escape begins (§3.3/§3.6). Fallback: gameOver.
      if (this.finaleCats.length > 0) return this.startFinale();
      this.phase = "gameOver";
      return { phase: "gameOver", deadline: null };
    }
    this.wheelSpinnerId = this.nextAliveAfter(this.wheelSpinnerId);
    this.wheelOutcome = null;
    return { phase: "wheel", deadline: this.now() + this.kt.wheelSpinMs };
  }

  // --- Aakhri Darwaza (§3.6, M4) --------------------------------------------
  private startFinale(): EnginePhase {
    const living = this.players.find((p) => p.alive);
    if (living === undefined || this.finaleCats.length === 0) {
      this.phase = "gameOver";
      return { phase: "gameOver", deadline: null };
    }
    const ghosts = this.players
      .filter((p) => !p.alive)
      .map((p) => ({ id: p.id, name: p.name, money: p.money }));
    const audience = this.audienceEnabled && this.audienceCount() > 0;
    this.finale = new AakhriDarwazaFinale(
      { id: living.id, name: living.name, money: living.money },
      ghosts,
      this.finaleCats,
      { rand: this.rand, audience, timers: this.opts.finaleTimers ?? {} },
    );
    this.phase = "finaleIntro";
    return { phase: "finaleIntro", deadline: this.finale.deadline(this.now()) };
  }

  private finaleTimeout(): EnginePhase | null {
    const f = this.finale;
    if (f === null) return null;
    const finished = f.onTimeout();
    if (finished) return this.applyFinaleOutcome();
    this.phase = f.subPhase() === "intro" ? "finaleIntro" : "finaleTurn";
    return { phase: this.phase, deadline: f.deadline(this.now()) };
  }

  private finaleAction(playerId: string, payload: unknown, meta: ActionMeta): EnginePhase | null {
    const f = this.finale;
    if (f === null) return null;
    // Audience members vote for the collective audience runner (§3.6); the
    // role comes from the room's authoritative meta, with an id fallback.
    const isAudience = meta.role === "audience" || !this.players.some((p) => p.id === playerId);
    const before = f.subPhase();
    const changed = f.onInput(playerId, payload, isAudience);
    if (!changed) return null;
    if (f.subPhase() !== before) {
      // All player runners locked early → the turn resolved.
      this.phase = "finaleTurn";
      return { phase: "finaleTurn", deadline: f.deadline(this.now()) };
    }
    return null;
  }

  /** The race is over: the winner takes the crown regardless of money (§3.6). */
  private applyFinaleOutcome(): EnginePhase {
    const f = this.finale!;
    this.finaleWinner = f.winnerId();
    this.finaleResult = { escaped: f.didEscape(), audienceEscaped: f.didAudienceEscape() };
    const someoneOut = f.didEscape() || f.didAudienceEscape();
    for (const p of this.players) {
      // Escape: only the crowned player leaves alive (a body-thief included).
      // Nobody out: the darkness kept everyone — all dead, richest crowned.
      p.alive = someoneOut && p.id === this.finaleWinner;
    }
    this.finale = null;
    this.phase = "gameOver";
    return { phase: "gameOver", deadline: null };
  }

  private nextAliveAfter(id: string): string {
    const order = this.wheelOrder.length > 0 ? this.wheelOrder : this.players.map((p) => p.id);
    const idx = order.indexOf(id);
    for (let step = 1; step <= order.length; step++) {
      const candidateId = order[(idx + step) % order.length]!;
      const candidate = this.players.find((p) => p.id === candidateId);
      if (candidate?.alive === true) return candidateId;
    }
    return id; // unreachable while 2+ alive
  }

  // --- snapshots -------------------------------------------------------------
  publicPhaseData(): KsPublicPhase {
    if (this.phase === "tutorial") return { kind: "tutorial", vo: VO.tutorial };
    if (this.phase === "question") {
      const q = this.currentQuestion();
      return {
        kind: "question",
        questionId: q.id,
        text: q.text,
        options: q.options,
        number: this.index + 1,
        total: this.questions.length,
        vo: VO.question,
      };
    }
    if (this.phase === "reveal") {
      const q = this.currentQuestion();
      const r = this.lastReveal!;
      return {
        kind: "reveal",
        questionId: q.id,
        text: q.text,
        options: q.options,
        correct: q.correct,
        tally: r.tally,
        deaths: r.deaths,
        floor: r.floor,
        mercy: r.mercy,
        allCorrect: r.allCorrect,
        vo: r.mercy ? VO.mercy : r.allCorrect ? VO.allCorrect : VO.sentenced,
      };
    }
    if (this.phase === "khooniKamra" && this.kamra !== null) {
      return this.kamra.publicPhase(this.now());
    }
    if ((this.phase === "finaleIntro" || this.phase === "finaleTurn") && this.finale !== null) {
      return this.finale.publicPhase();
    }
    if (this.phase === "wheel" && this.wheelSpinnerId !== null) {
      const spinner = this.players.find((p) => p.id === this.wheelSpinnerId);
      return {
        kind: "wheel",
        spinnerId: this.wheelSpinnerId,
        spinnerName: spinner?.name ?? "?",
        outcome: this.wheelOutcome,
        vo:
          this.wheelOutcome === null
            ? VO.wheelSpin
            : this.wheelOutcome === "death"
              ? VO.wheelDeath
              : VO.wheelLife,
      };
    }
    return {
      kind: "gameOver",
      standings: this.standings(),
      winnerId: this.finaleWinner ?? this.winnerId(),
      ...(this.finaleResult !== null ? { finale: this.finaleResult } : {}),
      vo: VO.gameOver,
    };
  }

  privatePhaseData(playerId: string): KsPrivatePhase {
    const p = this.players.find((x) => x.id === playerId);
    const isAudience = p === undefined;
    return {
      myAnswer: p?.answer ?? null,
      answered: p?.answer != null,
      alive: p?.alive ?? true,
      kamra: this.kamra !== null ? this.kamra.privateFor(playerId) : null,
      finale: this.finale !== null ? this.finale.privateFor(playerId, isAudience) : null,
    };
  }

  playerState(playerId: string): { alive: boolean; money: number; answered: boolean } | null {
    const p = this.players.find((x) => x.id === playerId);
    if (p === undefined) return null;
    const answered =
      this.phase === "khooniKamra" && this.kamra !== null
        ? this.kamra.privateFor(playerId).done
        : p.answer !== null;
    return { alive: p.alive, money: p.money, answered };
  }

  progress(): { number: number; total: number } {
    if (this.phase === "question" || this.phase === "reveal" || this.phase === "khooniKamra") {
      return { number: this.index + 1, total: this.questions.length };
    }
    return { number: 0, total: 0 };
  }

  private standings(): KsStanding[] {
    return [...this.players]
      .map((p) => ({ playerId: p.id, name: p.name, money: p.money, alive: p.alive }))
      .sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1; // alive first
        return b.money - a.money;
      });
  }
  private winnerId(): string | null {
    const s = this.standings();
    return s.length > 0 ? s[0]!.playerId : null;
  }

  isOver(): boolean {
    return this.phase === "gameOver";
  }
}

/**
 * Extract a valid option index from a game action payload, validating shape via
 * the single shared schema (QA-M2-7) and rejecting stale answers for a prior
 * question. Returns null on any invalid/mismatched payload.
 */
function parseAnswer(payload: unknown, expectedId: string): number | null {
  const parsed = ksActionSchema.safeParse(payload);
  if (!parsed.success) return null;
  const action = parsed.data;
  if (action.type !== "answer") return null; // not a trivia answer
  if (action.questionId !== expectedId) return null; // stale answer for a prior question
  return action.optionIndex;
}

/**
 * Default question selection: filter by family-friendly, shuffle, difficulty-
 * curve (easy→hard), and take up to n. Uses Math.random (server runtime).
 */
function defaultPick(bank: Question[], n: number, familyFriendly: boolean): Question[] {
  const pool = bank.filter((q) => !familyFriendly || !q.adult);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, Math.min(n, shuffled.length));
  return chosen.sort((a, b) => a.difficulty - b.difficulty);
}

export function createKhooniSawaalEngine(bank: Question[], opts: KsOptions = {}): () => GameEngine {
  return () => new KhooniSawaalEngine(bank, opts);
}
