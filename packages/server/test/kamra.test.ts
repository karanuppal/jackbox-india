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
  it("rigs the poison into a PICKED cup when nobody drew it (QA-M3-2)", () => {
    const g = new ZeharWaliChai(floor("a", "b"), deps(() => 0)); // poison cup 0
    g.onInput("a", answer({ type: "kmPick", index: 1 }));
    g.onInput("b", answer({ type: "kmPick", index: 2 }));
    const dead = g.resolveDeaths();
    expect(dead).toHaveLength(1);
    expect(["a", "b"]).toContain(dead[0]); // a picker — death is attributable
    // after the rig, re-resolving agrees the victim's own cup was poisoned
    expect(g.resolveDeaths()).toEqual(dead);
  });

  it("a solo floor player who dodges the poison SURVIVES (§3.4)", () => {
    const g = new ZeharWaliChai(floor("solo"), deps(() => 0)); // poison cup 0 of 3
    g.onInput("solo", answer({ type: "kmPick", index: 2 }));
    expect(g.resolveDeaths()).toEqual([]);
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
  it("everyone loyal: ALL survive but forfeit ₹500 each (§3.7, QA-M3-5)", () => {
    const g = new Dhokha(floor("a", "b"), deps(() => 0));
    g.onInput("a", answer({ type: "kmChoice", choice: "spare" }));
    g.onInput("b", answer({ type: "kmChoice", choice: "spare" }));
    expect(g.resolveDeaths()).toEqual([]);
    expect(g.payouts()).toEqual([
      { playerId: "a", amount: -500 },
      { playerId: "b", amount: -500 },
    ]); // loyalty is safe, never free
  });

  it("a UNIQUE betrayer takes the ₹1,000 pot (§3.7)", () => {
    const g = new Dhokha(floor("a", "b", "c"), deps(() => 0));
    g.onInput("a", answer({ type: "kmChoice", choice: "betray" }));
    g.onInput("b", answer({ type: "kmChoice", choice: "spare" }));
    g.onInput("c", answer({ type: "kmChoice", choice: "spare" }));
    expect(g.resolveDeaths().sort()).toEqual(["b", "c"]);
    expect(g.payouts()).toEqual([{ playerId: "a", amount: 1000 }]);
    // two betrayers → no pot for anyone
    const g2 = new Dhokha(floor("a", "b", "c"), deps(() => 0));
    g2.onInput("a", answer({ type: "kmChoice", choice: "betray" }));
    g2.onInput("b", answer({ type: "kmChoice", choice: "betray" }));
    g2.onInput("c", answer({ type: "kmChoice", choice: "spare" }));
    expect(g2.payouts()).toEqual([]);
  });
});

describe("K2 Yaaddasht (memory)", () => {
  it("scores tile recall and kills the worst; memorize window gates input (SEC-M3-3)", () => {
    const g = new Yaaddasht(floor("a", "b"), deps(seq([0.01, 0.05, 0.1, 0.15, 0.2])));
    // pattern is readable BEFORE play begins (the memorize phase)…
    const pa = g.privateFor("a") as { pattern: number[] };
    expect(pa.pattern).not.toBeNull();
    // …but recall input is rejected while the window is open
    expect(g.onInput("a", answer({ type: "kmRecall", selection: pa.pattern }))).toBe(false);
    g.beginPlay(-10_000); // window long closed at now()=1000
    // and once closed, the pattern leaves the private snapshot
    expect((g.privateFor("a") as { pattern: number[] | null }).pattern).toBeNull();
    g.onInput("a", answer({ type: "kmRecall", selection: pa.pattern })); // perfect
    g.onInput("b", answer({ type: "kmRecall", selection: [] })); // nothing
    expect(g.resolveDeaths()).toEqual(["b"]);
    // §3.7 payout: proportion of the PATTERN recalled — perfect = 1000, lazy = 0
    expect(g.payouts()).toEqual([
      { playerId: "a", amount: 1000 },
      { playerId: "b", amount: 0 },
    ]);
  });

  it("select-ALL pays nothing — payout uses net score, not raw hits (QA-M4-1)", () => {
    const g = new Yaaddasht(floor("spray", "honest"), deps(seq([0.01, 0.05, 0.1, 0.15, 0.2])));
    const pattern = (g.privateFor("spray") as { pattern: number[] }).pattern;
    g.beginPlay(-10_000);
    g.onInput("spray", answer({ type: "kmRecall", selection: Array.from({ length: 16 }, (_, i) => i) }));
    g.onInput("honest", answer({ type: "kmRecall", selection: pattern.slice(0, 3) }));
    const pay = Object.fromEntries(g.payouts().map((p) => [p.playerId, p.amount]));
    expect(pay["spray"]).toBe(0); // 5 hits − 11 false picks → net 0 → ₹0
    expect(pay["honest"]).toBe(600); // net 3/5 of ₹1000
    expect(g.resolveDeaths()).toEqual(["spray"]);
  });

  it("a pause mid-memorize does not burn the window (QA-M4-3)", () => {
    let t = 1000;
    const d: MinigameDeps = { now: () => t, rand: seq([0.01, 0.05, 0.1, 0.15, 0.2]), memorizeMs: 6000 };
    const g = new Yaaddasht(floor("a"), d);
    g.beginPlay(1000); // window: 1000..7000
    t = 4000; // 3s in — pause happens here for 60s
    g.shiftClock(60_000); // resume compensation
    t = 64_000; // wall clock after the pause (3s of window actually consumed)
    expect((g.privateFor("a") as { pattern: number[] | null }).pattern).not.toBeNull(); // still memorizing
    expect(g.onInput("a", answer({ type: "kmRecall", selection: [] }))).toBe(false);
    t = 68_000; // window (shifted to 61000..67000) now closed
    expect((g.privateFor("a") as { pattern: number[] | null }).pattern).toBeNull();
    expect(g.onInput("a", answer({ type: "kmRecall", selection: [] }))).toBe(true);
  });

  it("lazy empty submissions no longer out-earn genuine attempts (QA-M3-1)", () => {
    const g = new Yaaddasht(floor("lazy", "genuine"), deps(seq([0.01, 0.05, 0.1, 0.15, 0.2])));
    const pattern = (g.privateFor("lazy") as { pattern: number[] }).pattern;
    g.beginPlay(-10_000);
    g.onInput("lazy", answer({ type: "kmRecall", selection: [] })); // does nothing
    g.onInput("genuine", answer({ type: "kmRecall", selection: pattern.slice(0, 2) })); // 2 real tiles
    expect(g.resolveDeaths()).toEqual(["lazy"]); // 0 < 2
    const pay = Object.fromEntries(g.payouts().map((p) => [p.playerId, p.amount]));
    expect(pay["lazy"]).toBe(0);
    expect(pay["genuine"]).toBe(400); // 2/5 of ₹1000
  });
});

describe("K3 Taash Ke Patte (memory)", () => {
  it("scores symbol recall (spray-and-pray penalized) and kills the worst", () => {
    const g = new TaashKePatte(floor("a", "b"), deps(seq([0, 0.3, 0.6, 0.9, 0.1, 0.2])));
    const pa = g.privateFor("a") as { cards: number[]; target: number };
    expect(pa.cards).not.toBeNull();
    const correct = pa.cards.map((c, i) => (c === pa.target ? i : -1)).filter((i) => i >= 0);
    g.beginPlay(-10_000);
    expect((g.privateFor("a") as { cards: number[] | null }).cards).toBeNull(); // window closed
    g.onInput("a", answer({ type: "kmRecall", selection: correct }));
    g.onInput("b", answer({ type: "kmRecall", selection: [0, 1, 2, 3, 4] })); // spray
    expect(g.resolveDeaths()).toContain("b"); // false picks cancel hits
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
  it("censor hides CONTENT only — the entry stays on the ballot, votable and death-eligible (SEC-M3-4/UT-M3-2)", () => {
    const g = new SabseGhatiyaJawaab(floor("a", "b"), deps(), "prompt");
    g.onInput("a", answer({ type: "kmAnswer", text: "x" }));
    g.onInput("b", answer({ type: "kmAnswer", text: "gaali" }));
    g.onVote("v1", "b");
    g.censor("b");
    g.onVote("v2", "b"); // censored entries can STILL be voted (blank card)
    const entryB = g.voteEntries().find((e) => e.playerId === "b")!;
    expect(entryB.censored).toBe(true);
    expect(entryB.text).toBeNull(); // content hidden…
    expect(entryB.votesAgainst).toBe(2); // …but the ballot works
    expect(g.resolveDeaths()).toEqual(["b"]); // censorship is not immunity
  });

  it("all-censored / nobody-voted falls back to a RANDOM floor player, not seat 0 (QA-M3-11)", () => {
    // rand → 0.9 so the random fallback picks the LAST seat, proving it isn't
    // hardwired to seats[0]
    const g = new SabseGhatiyaJawaab(floor("a", "b"), deps(() => 0.9), "prompt");
    g.onInput("a", answer({ type: "kmAnswer", text: "x" }));
    g.onInput("b", answer({ type: "kmAnswer", text: "y" }));
    g.censor("a");
    g.censor("b"); // VIP censored everything; no votes possible
    expect(g.resolveDeaths()).toEqual(["b"]); // rand-driven, not seats[0]
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

describe("K6 forfeit keeps the draft (QA-M4-2)", () => {
  it("a disconnected drawer's strokes still reach the ballot", () => {
    const g = new GandaChitra(floor("a", "b"), deps(), "prompt");
    g.onInput("a", answer({ type: "drawStroke", stroke: { color: 1, width: 2, points: [[0.1, 0.1]] } }));
    g.forfeit("a"); // disconnect mid-draw
    g.onInput("b", answer({ type: "drawSubmit" }));
    const entryA = g.voteEntries().find((e) => e.playerId === "a")!;
    expect(entryA.strokes).toHaveLength(1); // the draft was auto-submitted
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
  it("censor works only in the vote phase, never on yourself, never in non-voting games", () => {
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "spellingShelling", "zeharWaliChai", "dhokha"]);
    const voting = new KamraCoordinator(floor("a", "b"), ["v1"], preSeen as never, deps(s()));
    expect(voting.censor("v1", "a")).toBe(false); // intro — too early (SEC-M3-5)
    voting.onTimeout(); // → play
    expect(voting.censor("v1", "a")).toBe(false); // play — still too early
    voting.onInput("a", { type: "kmAnswer", text: "x" });
    voting.onInput("b", { type: "kmAnswer", text: "y" }); // → vote (early advance)
    expect(voting.subPhase()).toBe("vote");
    expect(voting.censor("a", "a")).toBe(false); // self-censor rejected (QA-M3-3)
    expect(voting.censor("v1", "a")).toBe(true); // VIP censoring another entry
    const nonVoting = new KamraCoordinator(floor("a", "b"), [], new Set(), deps(s()));
    // a math/luck/etc game has no censor
    expect(nonVoting.censor("v1", "a")).toBe(false);
  });

  it("closes the vote early once every voter has voted (QA-M3-9)", () => {
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "spellingShelling", "zeharWaliChai", "dhokha"]);
    const co = new KamraCoordinator(floor("a", "b"), ["v1", "v2"], preSeen as never, deps(s()));
    co.onTimeout(); // → play
    co.onInput("a", { type: "kmAnswer", text: "x" });
    co.onInput("b", { type: "kmAnswer", text: "y" }); // → vote
    co.onInput("v1", { type: "kmVote", targetId: "a" });
    expect(co.subPhase()).toBe("vote"); // one ballot still out
    co.onInput("v2", { type: "kmVote", targetId: "a" });
    expect(co.subPhase()).toBe("result"); // all polls in → result early
    expect(co.getDeaths()).toContain("a");
  });

  it("forfeits a disconnected floor player and early-resolves the play (QA-M3-9)", () => {
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "sabseGhatiyaJawaab", "gandaChitra", "zeharWaliChai", "dhokha"]);
    const co = new KamraCoordinator(floor("a", "b"), [], preSeen as never, deps(s()));
    expect(co.game.kind).toBe("spellingShelling");
    co.onTimeout(); // → play
    co.onInput("a", { type: "kmSpell", word: "khichdi" });
    expect(co.subPhase()).toBe("play"); // waiting on b
    co.onPlayerLeft("b"); // b disconnects → seat forfeited → resolve
    expect(co.subPhase()).toBe("result");
    expect(co.getDeaths()).toEqual(["b"]); // never spelled → score 0 → dies
  });

  it("drops a disconnected voter from the electorate and closes when the rest voted", () => {
    const preSeen = new Set(["hisaabKitaab", "yaaddasht", "taashKePatte", "spellingShelling", "zeharWaliChai", "dhokha"]);
    const co = new KamraCoordinator(floor("a", "b"), ["v1", "v2"], preSeen as never, deps(s()));
    co.onTimeout(); // → play
    co.onInput("a", { type: "kmAnswer", text: "x" });
    co.onInput("b", { type: "kmAnswer", text: "y" }); // → vote
    co.onInput("v1", { type: "kmVote", targetId: "b" });
    co.onPlayerLeft("v2"); // the only outstanding voter leaves
    expect(co.subPhase()).toBe("result");
    expect(co.getDeaths()).toContain("b");
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
