import {
  CORRECT_REWARD,
  ksActionSchema,
  QUESTION_BUDGET,
  TIMERS,
  type KsPrivatePhase,
  type KsPublicPhase,
  type KsRevealOptionTally,
  type KsStanding,
  type Question,
} from "@tamasha/shared";
import type { ActionMeta, EnginePhase, GameContext, GameEngine } from "./engine.js";

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
  someDied: "Kuch mehmaan ab hamesha ke liye… mehmaan hi rahenge. Aatma ban ke khelte raho.",
  question: "Dhyaan se suniye…",
  gameOver: "Bas, itna hi. Manzil Mahal ne aaj apna hisaab-kitaab kar liya.",
} as const;

interface KsPlayer {
  id: string;
  name: string;
  alive: boolean;
  money: number;
  answer: number | null; // index for the current question
}

type Phase = "tutorial" | "question" | "reveal" | "gameOver";

export interface KsOptions {
  /** Deterministic selection for tests: pick `n` questions from the bank. */
  pickQuestions?: (bank: Question[], n: number, familyFriendly: boolean) => Question[];
  /** Override phase durations (ms) — used by tests for fast timer-driver runs. */
  timers?: Partial<Record<keyof typeof TIMERS, number>>;
}

/**
 * Khooni Sawaal trivia engine (PLAN.md §3.3). M2 covers the trivia loop:
 * tutorial → 10 questions with reveal + scoring + ghosts + mercy → gameOver.
 * The Khooni Kamra killing-floor (M3) and the Aakhri Darwaza finale (M4)
 * replace the direct wrong→ghost death and the placeholder ending later.
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
    mercy: boolean;
    allCorrect: boolean;
    tally: KsRevealOptionTally[];
  } | null = null;

  private readonly t: Record<keyof typeof TIMERS, number>;

  constructor(
    private readonly bank: Question[],
    private readonly opts: KsOptions = {},
  ) {
    this.t = { ...TIMERS, ...opts.timers };
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
      case "gameOver":
        return null;
    }
  }

  onAction(playerId: string, payload: unknown, _meta: ActionMeta): EnginePhase | null {
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
   *  still resolve in no-timer mode (§4.2, QA-M2-2). */
  onPlayerLeft(playerId: string): EnginePhase | null {
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

  /** Score the question, apply deaths/mercy, and enter the reveal phase. */
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
    // Mercy: everyone alive was wrong → nobody dies (§3.3).
    const deaths: string[] = [];
    if (!allLivingWrong) {
      for (const p of livingWrong) {
        p.alive = false;
        deaths.push(p.id);
      }
    }
    const counts = [0, 0, 0, 0];
    for (const p of this.players) {
      if (p.answer !== null && p.answer >= 0 && p.answer <= 3) counts[p.answer]! += 1;
    }
    this.lastReveal = {
      deaths,
      mercy: allLivingWrong,
      allCorrect,
      tally: counts.map((count, index) => ({ index, count, correct: index === correct })),
    };
    this.phase = "reveal";
    return { phase: "reveal", deadline: this.now() + this.t.revealMs };
  }

  private afterReveal(): EnginePhase {
    // M2 ends only when the question budget is exhausted, so a solo player (and
    // a game attrited to one survivor) plays the full 10 questions (§3.2
    // "fully playable solo"). §3.3's early transitions are deferred:
    //   • budget exhausted with 2+ alive → Maut Ka Chakra wheel  → M3/M4
    //   • 1 living player remaining        → Aakhri Darwaza finale → M4
    // Until those land, the game reaches gameOver at the budget (QA-M2-3/6).
    const done = this.index >= this.questions.length - 1;
    if (done) {
      this.phase = "gameOver";
      return { phase: "gameOver", deadline: null };
    }
    return this.beginQuestion();
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
        mercy: r.mercy,
        allCorrect: r.allCorrect,
        vo: r.mercy ? VO.mercy : r.allCorrect ? VO.allCorrect : VO.someDied,
      };
    }
    return { kind: "gameOver", standings: this.standings(), winnerId: this.winnerId(), vo: VO.gameOver };
  }

  privatePhaseData(playerId: string): KsPrivatePhase {
    const p = this.players.find((x) => x.id === playerId);
    return {
      myAnswer: p?.answer ?? null,
      answered: p?.answer != null,
      alive: p?.alive ?? true,
    };
  }

  playerState(playerId: string): { alive: boolean; money: number; answered: boolean } | null {
    const p = this.players.find((x) => x.id === playerId);
    if (p === undefined) return null;
    return { alive: p.alive, money: p.money, answered: p.answer !== null };
  }

  progress(): { number: number; total: number } {
    if (this.phase === "question" || this.phase === "reveal") {
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
