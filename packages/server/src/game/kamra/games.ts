import {
  MAX_STROKES,
  SOLO_MATH_SURVIVAL,
  type KamraFloorPlayer,
  type KamraVoteEntry,
  type KsAction,
  type MinigameKind,
  type Stroke,
} from "@tamasha/shared";
import { lowestScorersDie, type FloorInit, type Minigame, type MinigameDeps } from "./minigame.js";

interface Seat {
  playerId: string;
  name: string;
  score: number;
  done: boolean;
}

/** Pick `k` distinct indices from [0, n) via a partial Fisher-Yates shuffle —
 *  bounded (no rejection-sampling infinite loop on a degenerate rand). */
export function pickDistinct(n: number, k: number, rand: () => number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  const take = Math.min(k, n);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (n - i));
    const tmp = pool[i]!;
    pool[i] = pool[Math.min(j, n - 1)]!;
    pool[Math.min(j, n - 1)] = tmp;
  }
  return pool.slice(0, take);
}

abstract class Base implements Minigame {
  abstract readonly kind: MinigameKind;
  abstract readonly title: string;
  abstract readonly rules: string;
  readonly needsVote: boolean = false;
  protected seats: Seat[];
  protected readonly deps: MinigameDeps;

  constructor(floor: FloorInit[], deps: MinigameDeps) {
    this.deps = deps;
    this.seats = floor.map((f) => ({ playerId: f.playerId, name: f.name, score: 0, done: false }));
  }

  floorPublic(): KamraFloorPlayer[] {
    return this.seats.map((s) => ({ playerId: s.playerId, name: s.name, score: s.score, done: s.done }));
  }
  privateFor(_playerId: string): unknown {
    return null;
  }
  prompt(): string | null {
    return null;
  }
  allDone(): boolean {
    return this.seats.every((s) => s.done);
  }
  voteEntries(): KamraVoteEntry[] {
    return [];
  }
  onVote(_voterId: string, _targetId: string): void {
    /* non-voting default */
  }
  abstract onInput(playerId: string, action: KsAction): boolean;
  resolveDeaths(): string[] {
    return lowestScorersDie(this.seats);
  }
  payouts(): { playerId: string; amount: number }[] {
    return [];
  }
  protected get solo(): boolean {
    return this.seats.length === 1;
  }
  protected seat(id: string): Seat | undefined {
    return this.seats.find((s) => s.playerId === id);
  }
}

// K1 — Hisaab-Kitaab: rapid mental math. Each correct sum banks points; the
// lowest tally dies. Each player gets an independent stream of questions.
export class HisaabKitaab extends Base {
  readonly kind = "hisaabKitaab" as const;
  readonly title = "Hisaab-Kitaab";
  readonly rules = "Jaldi-jaldi jod-ghata karo. Sabse kam sahi jawab wala… gaya.";
  private q = new Map<string, { a: number; b: number; op: "+" | "-" }>();

  constructor(floor: FloorInit[], deps: MinigameDeps) {
    super(floor, deps);
    for (const s of this.seats) this.q.set(s.playerId, this.gen());
  }
  private gen(): { a: number; b: number; op: "+" | "-" } {
    const a = Math.floor(this.deps.rand() * 20);
    const b = Math.floor(this.deps.rand() * 20);
    return { a, b, op: this.deps.rand() < 0.5 ? "+" : "-" };
  }
  override privateFor(playerId: string): unknown {
    const q = this.q.get(playerId);
    return q === undefined ? null : { a: q.a, b: q.b, op: q.op };
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmMath") return false;
    const s = this.seat(playerId);
    const q = this.q.get(playerId);
    if (s === undefined || q === undefined || s.done) return false;
    const correct = q.op === "+" ? q.a + q.b : q.a - q.b;
    if (action.value === correct) s.score += 1;
    this.q.set(playerId, this.gen()); // next question either way
    return true;
  }
  /** The play timer expiring is what ends this game — mark all done then. */
  finish(): void {
    for (const s of this.seats) s.done = true;
  }
  /** §3.4 solo floor: death possible but not guaranteed — a solo player
   *  survives by clearing the bar instead of "lowest dies". */
  override resolveDeaths(): string[] {
    if (this.solo) {
      const s = this.seats[0]!;
      return s.score >= SOLO_MATH_SURVIVAL ? [] : [s.playerId];
    }
    return lowestScorersDie(this.seats);
  }
  /** §3.7: ₹25 per correct sum. */
  override payouts(): { playerId: string; amount: number }[] {
    return this.seats.map((s) => ({ playerId: s.playerId, amount: s.score * 25 }));
  }
}

// K7 — Zeher Wali Chai: each floor player picks a cutting-chai glass; one (or
// more) is poisoned. Pure luck. Those who pick a poisoned glass die (at least
// one poisoned glass always exists among the choices).
export class ZeharWaliChai extends Base {
  readonly kind = "zeharWaliChai" as const;
  readonly title = "Zeher Wali Chai";
  readonly rules = "Ek glass uthao. Kisi ek mein… thoda extra masala hai.";
  private readonly cups: number;
  private readonly poisoned: Set<number>;
  private picks = new Map<string, number>();

  constructor(floor: FloorInit[], deps: MinigameDeps) {
    super(floor, deps);
    // One more cup than players; exactly one poisoned so >=1 dies only if picked.
    this.cups = Math.max(this.seats.length + 1, 3);
    // Guarantee at least one death: poison enough cups that the pigeonhole
    // forces a hit is wrong for luck; instead poison 1 and, if nobody drew it,
    // resolveDeaths falls back to a random floor player (the game must kill 1).
    this.poisoned = new Set([Math.floor(deps.rand() * this.cups)]);
  }
  override prompt(): string | null {
    return `${this.cups} glass`;
  }
  override privateFor(playerId: string): unknown {
    return { cups: this.cups, myPick: this.picks.get(playerId) ?? null };
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmPick") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done || action.index >= this.cups) return false;
    this.picks.set(playerId, action.index);
    s.done = true;
    return true;
  }
  override resolveDeaths(): string[] {
    // A never-picked cup counts as drinking blind — un-picked players are
    // eligible for the poison fallback below but don't auto-die.
    const dead = this.seats.filter((s) => this.poisoned.has(this.picks.get(s.playerId) ?? -1)).map((s) => s.playerId);
    if (dead.length > 0) return dead;
    // §3.4 solo floor: pure luck, death NOT guaranteed — dodging the poison
    // solo means surviving the visit.
    if (this.solo) return [];
    // Multi floor, nobody drank the poison — the room still claims one (§3.4
    // "at least one dies"): a random floor player meets a different fate.
    const fallback = this.seats[Math.floor(this.deps.rand() * this.seats.length)];
    return fallback !== undefined ? [fallback.playerId] : [];
  }
}

// K8 — Dhokha: betrayal split. Each floor player secretly picks SPARE (loyalty)
// or SAVE MYSELF (betray). Loyalty table (§3.4):
//   • everyone SPAREs → all survive (the floor is spared entirely)
//   • exactly the betrayers survive; the loyal die — UNLESS everyone betrays,
//     in which case all die.
export class Dhokha extends Base {
  readonly kind = "dhokha" as const;
  readonly title = "Rishtedaari Test";
  readonly rules = "Chupke se chuno: doosron ko bachao (SPARE) ya khud ko (SAVE MYSELF).";
  private choice = new Map<string, "spare" | "betray">();

  override privateFor(playerId: string): unknown {
    return { myChoice: this.choice.get(playerId) ?? null };
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmChoice") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    this.choice.set(playerId, action.choice);
    s.done = true;
    return true;
  }
  override resolveDeaths(): string[] {
    const choices = this.seats.map((s) => ({ id: s.playerId, c: this.choice.get(s.playerId) ?? "spare" }));
    const betrayers = choices.filter((x) => x.c === "betray");
    if (betrayers.length === 0) {
      // §3.4/§3.7 loyalty table: universal loyalty → EVERYONE survives (the
      // one sanctioned exception to "at least one dies") but forfeits the
      // round's pot — nobody profits.
      return [];
    }
    if (betrayers.length === this.seats.length) {
      return this.seats.map((s) => s.playerId); // everyone betrayed → all die
    }
    // Mixed: the loyal (spare) players die; the betrayers escape.
    return choices.filter((x) => x.c === "spare").map((x) => x.id);
  }
  /** §3.7: a UNIQUE betrayer takes the pot (₹1,000). Everyone else gets 0. */
  override payouts(): { playerId: string; amount: number }[] {
    const betrayers = this.seats.filter((s) => this.choice.get(s.playerId) === "betray");
    if (betrayers.length !== 1) return [];
    return [{ playerId: betrayers[0]!.playerId, amount: 1000 }];
  }
}

// K2 — Yaaddasht: memorize highlighted tiles on a grid, reproduce them. Score
// = correctly recalled tiles; lowest dies.
export class Yaaddasht extends Base {
  readonly kind = "yaaddasht" as const;
  readonly title = "Yaaddasht";
  readonly rules = "Jo tiles jal rahe the yaad rakho, phir wahi dabaao.";
  private readonly size = 16; // 4x4
  private readonly pattern: Set<number>;

  constructor(floor: FloorInit[], deps: MinigameDeps) {
    super(floor, deps);
    this.pattern = new Set(pickDistinct(this.size, 5, deps.rand));
  }
  override privateFor(playerId: string): unknown {
    return { size: this.size, pattern: [...this.pattern], locked: this.seat(playerId)?.done ?? false };
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmRecall") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    const sel = new Set(action.selection.filter((i) => i < this.size));
    let score = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.pattern.has(i) === sel.has(i)) score += 1; // reward correct include/exclude
    }
    s.score = score;
    s.done = true;
    return true;
  }
  /** §3.7: ₹1,000 × proportion of the grid judged correctly. */
  override payouts(): { playerId: string; amount: number }[] {
    return this.seats.map((s) => ({
      playerId: s.playerId,
      amount: Math.round((1000 * s.score) / this.size),
    }));
  }
}

// K3 — Taash Ke Patte: memorize N cards (colour+symbol), answer a recall
// question. Simplified: recall which positions held a target symbol. Score =
// correct; lowest dies.
export class TaashKePatte extends Base {
  readonly kind = "taashKePatte" as const;
  readonly title = "Taash Ke Patte";
  readonly rules = "Patte yaad karo, phir sawaal ka jawab do.";
  private readonly cards: number[]; // symbol index 0..3 per card
  private readonly target: number;

  constructor(floor: FloorInit[], deps: MinigameDeps) {
    super(floor, deps);
    this.cards = Array.from({ length: 5 }, () => Math.floor(deps.rand() * 4));
    this.target = this.cards[Math.floor(deps.rand() * this.cards.length)]!;
  }
  override privateFor(playerId: string): unknown {
    return { cards: this.cards, target: this.target, locked: this.seat(playerId)?.done ?? false };
  }
  override prompt(): string | null {
    return `Kaun se patton par symbol ${this.target}?`;
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmRecall") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    const sel = new Set(action.selection);
    let score = 0;
    for (let i = 0; i < this.cards.length; i++) {
      if ((this.cards[i] === this.target) === sel.has(i)) score += 1;
    }
    s.score = score;
    s.done = true;
    return true;
  }
}

// K4 — Spelling Shelling: spell a shown word from memory. Score = 1 if exact
// (case-insensitive), else 0; lowest dies.
export class SpellingShelling extends Base {
  readonly kind = "spellingShelling" as const;
  readonly title = "Spelling Shelling";
  readonly rules = "Shabd ko sahi spell karo.";
  private readonly word: string;

  constructor(floor: FloorInit[], deps: MinigameDeps, word = "khichdi") {
    super(floor, deps);
    this.word = word;
  }
  override prompt(): string | null {
    return this.word;
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmSpell") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    s.score = action.word.trim().toLowerCase() === this.word.toLowerCase() ? 1 : 0;
    s.done = true;
    return true;
  }
  /** §3.4 solo floor: spell it right and you walk out alive. */
  override resolveDeaths(): string[] {
    if (this.solo) {
      const s = this.seats[0]!;
      return s.score === 1 ? [] : [s.playerId];
    }
    return lowestScorersDie(this.seats);
  }
  /** §3.7: ₹100 × word length for a correct spelling. */
  override payouts(): { playerId: string; amount: number }[] {
    return this.seats.map((s) => ({
      playerId: s.playerId,
      amount: s.score * 100 * this.word.length,
    }));
  }
}

// --- voting minigames (K5 worst-answer, K6 worst-drawing) -----------------
abstract class VotingBase extends Base {
  override readonly needsVote = true;
  protected answers = new Map<string, { text: string | null; strokes: Stroke[] | null }>();
  private votes = new Map<string, string>(); // voterId → targetId
  protected censored = new Set<string>();

  override voteEntries(): KamraVoteEntry[] {
    return this.seats
      .filter((s) => !this.censored.has(s.playerId))
      .map((s) => {
        const a = this.answers.get(s.playerId);
        const against = [...this.votes.values()].filter((t) => t === s.playerId).length;
        return {
          playerId: s.playerId,
          name: s.name,
          text: a?.text ?? null,
          strokes: a?.strokes ?? null,
          votesAgainst: against,
        };
      });
  }
  override onVote(voterId: string, targetId: string): void {
    if (this.seats.some((s) => s.playerId === targetId) && !this.censored.has(targetId)) {
      this.votes.set(voterId, targetId); // one vote per voter; last wins
    }
  }
  /** VIP/host censors a submission — it can't win "worst". */
  censor(targetId: string): void {
    this.censored.add(targetId);
  }
  override resolveDeaths(): string[] {
    // Most votes-against (the "worst") dies; ties → all tied die. If nobody
    // voted, the room still claims the last submitter (a random floor player).
    const counts = this.seats
      .filter((s) => !this.censored.has(s.playerId))
      .map((s) => ({ id: s.playerId, n: [...this.votes.values()].filter((t) => t === s.playerId).length }));
    if (counts.length === 0) return [this.seats[0]!.playerId];
    const max = Math.max(...counts.map((c) => c.n));
    if (max === 0) {
      const v = this.seats[Math.floor(this.deps.rand() * this.seats.length)];
      return v !== undefined ? [v.playerId] : [];
    }
    return counts.filter((c) => c.n === max).map((c) => c.id);
  }
}

export class SabseGhatiyaJawaab extends VotingBase {
  readonly kind = "sabseGhatiyaJawaab" as const;
  readonly title = "Sabse Ghatiya Jawaab";
  readonly rules = "Prompt ka jawab likho. Baaki sab sabse ghatiya jawab ko vote denge.";
  private readonly promptText: string;

  constructor(floor: FloorInit[], deps: MinigameDeps, promptText = "Aunty ka good-morning message") {
    super(floor, deps);
    this.promptText = promptText;
  }
  override prompt(): string | null {
    return this.promptText;
  }
  onInput(playerId: string, action: KsAction): boolean {
    if (action.type !== "kmAnswer") return false;
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    this.answers.set(playerId, { text: action.text, strokes: null });
    s.done = true;
    return true;
  }
}

export class GandaChitra extends VotingBase {
  readonly kind = "gandaChitra" as const;
  readonly title = "Ganda Chitra";
  readonly rules = "Prompt ko banao (phone par). Baaki sab sabse ghatiya drawing ko vote denge.";
  private readonly promptText: string;
  private drafts = new Map<string, Stroke[]>();

  constructor(floor: FloorInit[], deps: MinigameDeps, promptText = "Monsoon mein Mumbai local") {
    super(floor, deps);
    this.promptText = promptText;
  }
  override prompt(): string | null {
    return this.promptText;
  }
  override privateFor(playerId: string): unknown {
    return { strokes: this.drafts.get(playerId) ?? [], submitted: this.seat(playerId)?.done ?? false };
  }
  onInput(playerId: string, action: KsAction): boolean {
    const s = this.seat(playerId);
    if (s === undefined || s.done) return false;
    const draft = this.drafts.get(playerId) ?? [];
    switch (action.type) {
      case "drawStroke":
        if (draft.length >= MAX_STROKES) return false;
        draft.push(action.stroke);
        this.drafts.set(playerId, draft);
        return true;
      case "drawUndo":
        draft.pop();
        this.drafts.set(playerId, draft);
        return true;
      case "drawClear":
        this.drafts.set(playerId, []);
        return true;
      case "drawSubmit":
        this.answers.set(playerId, { text: null, strokes: this.drafts.get(playerId) ?? [] });
        s.done = true;
        return true;
      default:
        return false;
    }
  }
}
