import { describe, expect, it } from "vitest";
import type { KsAction } from "@tamasha/shared";
import {
  Dhokha,
  GandaChitra,
  HisaabKitaab,
  SabseGhatiyaJawaab,
  SpellingShelling,
  TaashKePatte,
  Yaaddasht,
  ZeharWaliChai,
} from "../src/game/kamra/games.js";
import { KamraCoordinator, pickMinigame } from "../src/game/kamra/coordinator.js";
import type { FloorInit, MinigameDeps } from "../src/game/kamra/minigame.js";

// Deterministic randomness: a cycling sequence.
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}
const deps = (rand: () => number = () => 0): MinigameDeps => ({ now: () => 1000, rand });
const floor = (...names: string[]): FloorInit[] => names.map((n) => ({ playerId: n, name: n }));

const answer = (t: KsAction): KsAction => t;

describe("K1 Hisaab-Kitaab (math)", () => {
  it("scores correct sums and kills the lowest tally", () => {
    // rand sequence produces the questions; compute the correct answer from privateFor
    const g = new HisaabKitaab(floor("a", "b"), deps(seq([0.1, 0.2, 0.9, 0.9])));
    const qa = g.privateFor("a") as { a: number; b: number; op: "+" | "-" };
    const correctA = qa.op === "+" ? qa.a + qa.b : qa.a - qa.b;
    g.onInput("a", answer({ type: "kmMath", value: correctA })); // a correct
    const qb = g.privateFor("b") as { a: number; b: number; op: "+" | "-" };
    const wrongB = (qb.op === "+" ? qb.a + qb.b : qb.a - qb.b) + 100;
    g.onInput("b", answer({ type: "kmMath", value: wrongB })); // b wrong
    g.finish();
    expect(g.allDone()).toBe(true);
    expect(g.resolveDeaths()).toEqual(["b"]); // lowest score dies
  });
});

describe("K7 Zeher Wali Chai (luck)", () => {
  it("kills whoever draws the poisoned cup", () => {
    // 2 players → 3 cups; rand=0 poisons cup 0
    const g = new ZeharWaliChai(floor("a", "b"), deps(() => 0));
    g.onInput("a", answer({ type: "kmPick", index: 0 })); // poisoned
    g.onInput("b", answer({ type: "kmPick", index: 1 })); // safe
    expect(g.resolveDeaths()).toEqual(["a"]);
  });
  it("still claims a victim if nobody drew the poison", () => {
    const g = new ZeharWaliChai(floor("a", "b"), deps(() => 0)); // poison cup 0
    g.onInput("a", answer({ type: "kmPick", index: 1 }));
    g.onInput("b", answer({ type: "kmPick", index: 2 }));
    expect(g.resolveDeaths()).toHaveLength(1); // fallback kill
  });
});

describe("K8 Dhokha (betrayal)", () => {
  it("mixed choices: the loyal die, betrayers escape", () => {
    const g = new Dhokha(floor("a", "b", "c"), deps());
    g.onInput("a", answer({ type: "kmChoice", choice: "spare" }));
    g.onInput("b", answer({ type: "kmChoice", choice: "betray" }));
    g.onInput("c", answer({ type: "kmChoice", choice: "spare" }));
    expect(g.resolveDeaths().sort()).toEqual(["a", "c"]);
  });
  it("everyone betrays: all die", () => {
    const g = new Dhokha(floor("a", "b"), deps());
    g.onInput("a", answer({ type: "kmChoice", choice: "betray" }));
    g.onInput("b", answer({ type: "kmChoice", choice: "betray" }));
    expect(g.resolveDeaths().sort()).toEqual(["a", "b"]);
  });
  it("everyone loyal: the room still claims one", () => {
    const g = new Dhokha(floor("a", "b"), deps(() => 0));
    g.onInput("a", answer({ type: "kmChoice", choice: "spare" }));
    g.onInput("b", answer({ type: "kmChoice", choice: "spare" }));
    expect(g.resolveDeaths()).toHaveLength(1);
  });
});

describe("K2 Yaaddasht (memory)", () => {
  it("scores tile recall and kills the worst", () => {
    const g = new Yaaddasht(floor("a", "b"), deps(seq([0.01, 0.05, 0.1, 0.15, 0.2])));
    const pa = g.privateFor("a") as { pattern: number[] };
    g.onInput("a", answer({ type: "kmRecall", selection: pa.pattern })); // perfect
    g.onInput("b", answer({ type: "kmRecall", selection: [] })); // nothing
    expect(g.resolveDeaths()).toEqual(["b"]);
  });
});

describe("K3 Taash Ke Patte (memory)", () => {
  it("scores symbol recall and kills the worst", () => {
    const g = new TaashKePatte(floor("a", "b"), deps(seq([0, 0.3, 0.6, 0.9, 0.1, 0.2])));
    const pa = g.privateFor("a") as { cards: number[]; target: number };
    const correct = pa.cards.map((c, i) => (c === pa.target ? i : -1)).filter((i) => i >= 0);
    g.onInput("a", answer({ type: "kmRecall", selection: correct }));
    g.onInput("b", answer({ type: "kmRecall", selection: [0, 1, 2, 3, 4] })); // spray
    expect(g.resolveDeaths()).toContain("b");
  });
});

describe("K4 Spelling Shelling (skill)", () => {
  it("kills the misspeller", () => {
    const g = new SpellingShelling(floor("a", "b"), deps(), "khichdi");
    g.onInput("a", answer({ type: "kmSpell", word: "khichdi" }));
    g.onInput("b", answer({ type: "kmSpell", word: "kichari" }));
    expect(g.resolveDeaths()).toEqual(["b"]);
  });
});

describe("K5 Sabse Ghatiya Jawaab (voting)", () => {
  it("kills the most-voted-against answer", () => {
    const g = new SabseGhatiyaJawaab(floor("a", "b"), deps(), "prompt");
    g.onInput("a", answer({ type: "kmAnswer", text: "achha" }));
    g.onInput("b", answer({ type: "kmAnswer", text: "ghatiya" }));
    g.onVote("v1", "b");
    g.onVote("v2", "b");
    g.onVote("v3", "a");
    expect(g.resolveDeaths()).toEqual(["b"]);
  });
  it("respects VIP censor — a censored entry can't be voted or win", () => {
    const g = new SabseGhatiyaJawaab(floor("a", "b"), deps(), "prompt");
    g.onInput("a", answer({ type: "kmAnswer", text: "x" }));
    g.onInput("b", answer({ type: "kmAnswer", text: "gaali" }));
    g.censor("b");
    g.onVote("v1", "b"); // vote against censored → ignored
    expect(g.voteEntries().some((e) => e.playerId === "b")).toBe(false);
    expect(g.resolveDeaths()).toEqual(["a"]); // b is out; a is the only target
  });
});

describe("K6 Ganda Chitra (drawing + voting)", () => {
  it("accumulates strokes, submits, and votes to a death", () => {
    const g = new GandaChitra(floor("a", "b"), deps(), "prompt");
    g.onInput("a", answer({ type: "drawStroke", stroke: { color: 1, width: 2, points: [[0.1, 0.1]] } }));
    g.onInput("a", answer({ type: "drawStroke", stroke: { color: 1, width: 2, points: [[0.2, 0.2]] } }));
    g.onInput("a", answer({ type: "drawUndo" }));
    g.onInput("a", answer({ type: "drawSubmit" }));
    g.onInput("b", answer({ type: "drawSubmit" }));
    const entryA = g.voteEntries().find((e) => e.playerId === "a")!;
    expect(entryA.strokes).toHaveLength(1); // 2 added, 1 undone
    g.onVote("v1", "a");
    expect(g.resolveDeaths()).toEqual(["a"]);
  });
});

describe("KamraCoordinator", () => {
  it("runs intro → play → result for a non-voting game", () => {
    const seen = new Set<never>();
    const co = new KamraCoordinator(floor("a", "b"), [], seen as Set<never> as never, deps(seq([0.1, 0.4, 0.7, 0.2, 0.9])));
    expect(co.subPhase()).toBe("intro");
    expect(co.onTimeout()).toBe(false); // → play
    expect(co.subPhase()).toBe("play");
    expect(co.onTimeout()).toBe(false); // → result (no vote)
    expect(co.subPhase()).toBe("result");
    expect(co.getDeaths().length).toBeGreaterThanOrEqual(1);
    expect(co.onTimeout()).toBe(true); // finished
  });

  it("routes voting games through a vote phase when voters exist", () => {
    const seen = new Set<never>();
    // force a voting game by seeding seen with all non-voting kinds
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "spellingShelling", "zeharWaliChai", "dhokha"]);
    const co = new KamraCoordinator(floor("a", "b"), ["v1"], preSeen as never, deps(seq([0.1, 0.4, 0.7])));
    expect(["sabseGhatiyaJawaab", "gandaChitra"]).toContain(co.game.kind);
    co.onTimeout(); // → play
    co.onTimeout(); // → vote (needsVote + voters)
    expect(co.subPhase()).toBe("vote");
    co.onInput("v1", { type: "kmVote", targetId: "a" });
    co.onTimeout(); // → result
    expect(co.subPhase()).toBe("result");
    expect(co.getDeaths()).toContain("a");
    void seen;
  });

  it("private view exposes floor membership", () => {
    const co = new KamraCoordinator(floor("a", "b"), [], new Set(), deps(seq([0.1, 0.4, 0.7])));
    expect(co.privateFor("a").onFloor).toBe(true);
    expect(co.privateFor("stranger").onFloor).toBe(false);
  });
});

describe("pickMinigame selection", () => {
  it("excludes voting games without enough floor/voters", () => {
    const k = pickMinigame(1, 0, new Set(), () => 0);
    expect(["sabseGhatiyaJawaab", "gandaChitra"]).not.toContain(k);
  });
  it("prefers unseen games until all are used", () => {
    const seen = new Set(["hisaabKitaab"] as const);
    const k = pickMinigame(2, 2, seen as never, () => 0);
    expect(k).not.toBe("hisaabKitaab");
  });
});

describe("KamraCoordinator — snapshots & censor", () => {
  const s = () => seq([0.1, 0.4, 0.7, 0.2, 0.9]);
  it("emits a public phase for every sub-phase", () => {
    const co = new KamraCoordinator(floor("a", "b"), [], new Set(), deps(s()));
    expect(co.publicPhase(1000).kind).toBe("kamraIntro");
    co.onTimeout();
    expect(co.publicPhase(1000).kind).toBe("kamraPlay");
    co.onTimeout();
    expect(co.publicPhase(1000).kind).toBe("kamraResult");
  });
  it("exposes sub-phase deadlines", () => {
    const co = new KamraCoordinator(floor("a", "b"), [], new Set(), deps(s()));
    expect(co.deadline(1000)).toBeGreaterThan(1000); // intro
    co.onTimeout();
    expect(co.deadline(1000)).toBeGreaterThan(1000); // play
  });
  it("routes a censor to a voting game and ignores it for non-voting", () => {
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "spellingShelling", "zeharWaliChai", "dhokha"]);
    const voting = new KamraCoordinator(floor("a", "b"), ["v1"], preSeen as never, deps(s()));
    expect(voting.censor("a")).toBe(true);
    const nonVoting = new KamraCoordinator(floor("a", "b"), [], new Set(), deps(s()));
    // a math/luck/etc game has no censor
    expect(nonVoting.censor("a")).toBe(false);
  });
  it("resolves all floor players locking in early during play", () => {
    // spelling: both submit → allDone → resolves without waiting for the timer
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "sabseGhatiyaJawaab", "gandaChitra", "zeharWaliChai", "dhokha"]);
    const co = new KamraCoordinator(floor("a", "b"), [], preSeen as never, deps(s()));
    expect(co.game.kind).toBe("spellingShelling");
    co.onTimeout(); // → play
    co.onInput("a", { type: "kmSpell", word: "khichdi" });
    const advanced = co.onInput("b", { type: "kmSpell", word: "nope" }); // all done → resolve
    expect(advanced).toBe(true);
    expect(co.subPhase()).toBe("result");
  });
});
