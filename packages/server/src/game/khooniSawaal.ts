import {
  CORRECT_REWARD,
  QUESTION_BUDGET,
  TIMERS,
  type KsPrivatePhase,
  type KsPublicPhase,
  type KsRevealOptionTally,
  type KsStanding,
  type Question,
} from "@tamasha/shared";
import type { ActionMeta, EnginePhase, GameContext, GameEngine } from "./engine.js";

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

  constructor(
    private readonly bank: Question[],
    private readonly opts: KsOptions = {},
  ) {}

  start(ctx: GameContext): EnginePhase {
    this.now = ctx.now;
    this.players = ctx.players.map((p) => ({ id: p.id, name: p.name, alive: true, money: 0, answer: null }));
    const pick = this.opts.pickQuestions ?? defaultPick;
    this.questions = pick(this.bank, QUESTION_BUDGET, ctx.settings.familyFriendly);
    this.questionMs =
      ctx.settings.timerMode === "extended"
        ? TIMERS.questionMs * 2
        : ctx.settings.timerMode === "off"
          ? 0 // untimed: the question resolves only when everyone answers (§3.3)
          : TIMERS.questionMs;
    this.phase = "tutorial";
    if (ctx.settings.skipTutorial) return this.beginQuestion();
    return { phase: "tutorial", deadline: this.now() + TIMERS.tutorialMs };
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
    // Everyone (alive + ghost) has locked in → resolve immediately.
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
    for (const p of this.players) if (p.answer !== null) counts[p.answer]! += 1;
    this.lastReveal = {
      deaths,
      mercy: allLivingWrong,
      allCorrect,
      tally: counts.map((count, index) => ({ index, count, correct: index === correct })),
    };
    this.phase = "reveal";
    return { phase: "reveal", deadline: this.now() + TIMERS.revealMs };
  }

  private afterReveal(): EnginePhase {
    const alive = this.players.filter((p) => p.alive).length;
    const done = this.index >= this.questions.length - 1 || alive <= 1;
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

/** Extract a valid option index from a game action payload. */
function parseAnswer(payload: unknown, expectedId: string): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as { type?: unknown; questionId?: unknown; optionIndex?: unknown };
  if (p.type !== "answer") return null;
  if (p.questionId !== expectedId) return null; // stale answer for a prior question
  if (typeof p.optionIndex !== "number" || !Number.isInteger(p.optionIndex)) return null;
  if (p.optionIndex < 0 || p.optionIndex > 3) return null;
  return p.optionIndex;
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
