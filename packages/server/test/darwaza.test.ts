// Aakhri Darwaza finale engine tests + simulation suite (PLAN.md §3.6, M4).
import { describe, expect, it } from "vitest";
import type { FinaleCategory, FinalePublic } from "@tamasha/shared";
import {
  AUDIENCE_RUNNER_ID,
  FINALE_DARKNESS_START,
  FINALE_GHOST_PACK,
  FINALE_START_LIVING,
} from "@tamasha/shared";
import { AakhriDarwazaFinale, type FinaleEntrant } from "../src/game/darwaza/finale.js";

/** A category where options 0..3 fit and 4..7 don't — full control in tests. */
function cat(id = 1): FinaleCategory {
  return {
    id: `f_${String(id).padStart(4, "0")}`,
    title: "SRK double roles",
    vo: `f_${String(id).padStart(4, "0")}.ogg`,
    adult: false,
    options: [
      { text: "Duplicate", fits: true },
      { text: "Don", fits: true },
      { text: "Fan", fits: true },
      { text: "Ra.One", fits: true },
      { text: "DDLJ", fits: false },
      { text: "Swades", fits: false },
      { text: "Chak De", fits: false },
      { text: "Devdas", fits: false },
    ],
    source: "test fixture",
  };
}

const entrant = (id: string, money = 0): FinaleEntrant => ({ id, name: id, money });

/** rand()=0 → deterministic: assignments pick the FIRST n options (0,1 / 0,1,2),
 *  which under cat() all FIT. Darkness advances 2. Ties resolve to index 0. */
function makeFinale(over: {
  ghosts?: FinaleEntrant[];
  audience?: boolean;
  rand?: () => number;
  categories?: FinaleCategory[];
} = {}) {
  return new AakhriDarwazaFinale(
    entrant("L", 5000),
    over.ghosts ?? [entrant("g1", 3000), entrant("g2", 2000)],
    over.categories ?? [cat()],
    { rand: over.rand ?? (() => 0), audience: over.audience ?? false },
  );
}

function pub(f: AakhriDarwazaFinale): FinalePublic {
  return f.publicPhase();
}

/** Judge perfectly: select exactly the assigned options that fit. */
function judgePerfect(f: AakhriDarwazaFinale, id: string, audience = false) {
  const priv = f.privateFor(id, audience);
  const sel = (priv.options ?? []).filter((o) => o.text !== "DDLJ" && !["Swades", "Chak De", "Devdas"].includes(o.text)).map((o) => o.index);
  return f.onInput(id, { type: "fjJudge", turn: f.currentTurn(), selection: sel }, audience);
}
/** Judge everything wrong: select exactly the non-fitting picks and skip fits. */
function judgeWrong(f: AakhriDarwazaFinale, id: string) {
  const priv = f.privateFor(id, false);
  const sel = (priv.options ?? []).filter((o) => ["DDLJ", "Swades", "Chak De", "Devdas"].includes(o.text)).map((o) => o.index);
  return f.onInput(id, { type: "fjJudge", turn: f.currentTurn(), selection: sel });
}

describe("AakhriDarwazaFinale — setup (§3.6 track geometry)", () => {
  it("starts the living at 14, richest ghosts at 3/2/1 head starts, pack at 21", () => {
    const f = makeFinale({ ghosts: [entrant("poor", 100), entrant("rich", 9000), entrant("mid", 500)] });
    const runners = pub(f).runners;
    expect(runners.find((r) => r.id === "L")).toMatchObject({ kind: "living", distance: FINALE_START_LIVING });
    expect(runners.find((r) => r.id === "rich")!.distance).toBe(FINALE_GHOST_PACK - 3);
    expect(runners.find((r) => r.id === "mid")!.distance).toBe(FINALE_GHOST_PACK - 2);
    expect(runners.find((r) => r.id === "poor")!.distance).toBe(FINALE_GHOST_PACK - 1);
  });

  it("a 4th+ ghost starts at the 21-space pack", () => {
    const ghosts = [entrant("a", 4), entrant("b", 3), entrant("c", 2), entrant("d", 1)];
    const f = makeFinale({ ghosts });
    expect(pub(f).runners.find((r) => r.id === "d")!.distance).toBe(FINALE_GHOST_PACK);
  });

  it("includes the audience runner only when enabled", () => {
    expect(pub(makeFinale({ audience: true })).runners.some((r) => r.id === AUDIENCE_RUNNER_ID)).toBe(true);
    expect(pub(makeFinale()).runners.some((r) => r.id === AUDIENCE_RUNNER_ID)).toBe(false);
  });
});

describe("AakhriDarwazaFinale — judging & movement", () => {
  it("gives the living 2 options and ghosts 3 (solo living gets 3)", () => {
    const f = makeFinale();
    f.onTimeout(); // intro → judge turn 1
    expect(f.privateFor("L").options).toHaveLength(2);
    expect(f.privateFor("g1").options).toHaveLength(3);
    const solo = makeFinale({ ghosts: [] });
    solo.onTimeout();
    expect(solo.privateFor("L").options).toHaveLength(3);
  });

  it("moves 1 space per correct judgment and locks in (no takebacks)", () => {
    const f = makeFinale();
    f.onTimeout(); // judge t1
    expect(judgePerfect(f, "L")).toBe(true);
    expect(f.onInput("L", { type: "fjJudge", turn: 1, selection: [] })).toBe(false); // locked
    judgeWrong(f, "g1");
    judgePerfect(f, "g2"); // all locked → early resolve
    const p = pub(f);
    expect(p.kind === "finaleTurn" && p.sub).toBe("resolve");
    const runners = p.kind === "finaleTurn" ? p.runners : [];
    expect(runners.find((r) => r.id === "L")!.distance).toBe(FINALE_START_LIVING - 2); // perfect 2-for-2
    expect(runners.find((r) => r.id === "g1")!.lastMove).toBe(0); // all wrong
  });

  it("rejects stale-turn locks, unknown players, and non-assigned options", () => {
    const f = makeFinale();
    f.onTimeout(); // judge t1
    expect(f.onInput("L", { type: "fjJudge", turn: 99, selection: [] })).toBe(false);
    expect(f.onInput("nope", { type: "fjJudge", turn: 1, selection: [] })).toBe(false);
    expect(f.onInput("L", { nonsense: true })).toBe(false);
    // out-of-assignment indices are filtered, not scored
    f.onInput("L", { type: "fjJudge", turn: 1, selection: [7, 6, 5] });
    judgeWrong(f, "g1");
    judgeWrong(f, "g2");
    const runners = pub(f).kind === "finaleTurn" ? (pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>).runners : [];
    // L's assigned options (0,1 — both fit) were NOT selected → 0 correct
    expect(runners.find((r) => r.id === "L")!.lastMove).toBe(0);
  });
});

describe("AakhriDarwazaFinale — body stealing (§3.6)", () => {
  it("a ghost reaching the living player's space steals the body; victim goes to the pack", () => {
    // Living answers wrong every turn; rich ghost (head start 18) races at 3/turn.
    const f = makeFinale({ ghosts: [entrant("hunter", 9000)] });
    f.onTimeout(); // judge t1
    let stolen = false;
    for (let t = 0; t < 6 && !stolen; t++) {
      judgeWrong(f, "L");
      judgePerfect(f, "hunter"); // early resolve
      const p = pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>;
      if (p.events.some((e) => e.type === "steal")) {
        stolen = true;
        expect(p.runners.find((r) => r.id === "hunter")!.kind).toBe("living");
        const victim = p.runners.find((r) => r.id === "L")!;
        expect(victim.kind).toBe("ghost");
        expect(victim.distance).toBe(FINALE_GHOST_PACK);
      }
      f.onTimeout(); // resolve → next judge
    }
    expect(stolen).toBe(true);
  });
});

describe("AakhriDarwazaFinale — darkness & barrier", () => {
  it("darkness starts sweeping after 3 turns and eliminates caught runners", () => {
    // Everyone idles (no inputs) → resolve on timeouts; pack ghosts get eaten.
    const f = makeFinale({ ghosts: [entrant("g1", 1), entrant("g2", 2), entrant("g3", 3), entrant("g4", 4)] });
    f.onTimeout(); // → judge t1
    let eliminated: string[] = [];
    for (let t = 1; t <= 6; t++) {
      f.onTimeout(); // judge times out → resolve
      const p = pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>;
      eliminated = eliminated.concat(p.events.filter((e) => e.type === "darkness").map((e) => e.id));
      if (t <= 3) expect(p.darkness).toBe(FINALE_DARKNESS_START); // grace period
      f.onTimeout(); // resolve → next judge (or over)
      if (f.isOverPhase()) break;
    }
    expect(eliminated.length).toBeGreaterThan(0); // the pack gets eaten first
    // g1 is the POOREST ghost → no head start → starts at the 21-space pack
    // and is swallowed before the living player at 14.
    expect(eliminated).toContain("g1");
  });

  it("an imperfect turn cannot cross the door (barrier), a perfect one escapes and wins", () => {
    // Solo: living at 14, 3 options/turn. 4 perfect turns = 12 → distance 2.
    const f = makeFinale({ ghosts: [] });
    f.onTimeout(); // judge t1
    for (let t = 1; t <= 4; t++) {
      judgePerfect(f, "L");
      f.onTimeout(); // resolve → judge
    }
    let p = pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>;
    expect(p.runners.find((r) => r.id === "L")!.distance).toBe(2); // at the barrier
    // Imperfect: 2 correct of 3 → would cross (2-2=0) but the barrier blocks.
    const priv = f.privateFor("L");
    const fits = (priv.options ?? []).filter((o) => ["Duplicate", "Don", "Fan", "Ra.One"].includes(o.text)).map((o) => o.index);
    // under rand()=0 all 3 assigned options fit; picking 2 of 3 scores exactly 2
    f.onInput("L", { type: "fjJudge", turn: f.currentTurn(), selection: fits.slice(0, 2) });
    p = pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>;
    expect(p.events.some((e) => e.type === "barrier")).toBe(true);
    expect(f.isFinished()).toBe(false);
    f.onTimeout(); // → judge
    // Perfect 3-for-3 breaks through (§3.6 TMP2 barrier rule).
    judgePerfect(f, "L");
    expect(f.isFinished()).toBe(true);
    expect(f.winnerId()).toBe("L");
    expect(f.didEscape()).toBe(true);
  });

  it("if the darkness swallows the body, nobody escapes and the richest takes the gag crown", () => {
    // Nobody ever judges: darkness sweeps everyone. L has 5000, ghosts less.
    const f = makeFinale();
    f.onTimeout();
    for (let i = 0; i < 30 && !f.isFinished(); i++) f.onTimeout();
    expect(f.isFinished()).toBe(true);
    expect(f.didEscape()).toBe(false);
    expect(f.winnerId()).toBe("L"); // richest corpse
  });
});

describe("AakhriDarwazaFinale — audience runner (§3.6)", () => {
  it("audience majority moves the runner; audience escape crowns the body holder", () => {
    const f = makeFinale({ ghosts: [], audience: true });
    f.onTimeout(); // judge t1
    // 3 audience members vote; 2 pick the fitting options → majority fits.
    for (let t = 0; t < 12 && !f.isFinished(); t++) {
      judgePerfect(f, "aud1", true);
      judgePerfect(f, "aud2", true);
      f.onInput("aud3", { type: "fjJudge", turn: f.currentTurn(), selection: [] }, true);
      // living never judges — the audience should win the race
      f.onTimeout(); // judge timeout → resolve
      f.onTimeout(); // resolve → judge/over
    }
    expect(f.isFinished()).toBe(true);
    expect(f.didAudienceEscape()).toBe(true);
    expect(f.winnerId()).toBe("L"); // crown falls to the living body holder
  });

  it("sybil audience sockets sharing one dedupe key count as ONE voice (SEC-M4-1)", () => {
    const f = makeFinale({ ghosts: [], audience: true });
    f.onTimeout(); // judge t1
    const assigned = (f.privateFor("m", true).options ?? []).map((o) => o.index);
    const all = { type: "fjJudge", turn: f.currentTurn(), selection: assigned };
    const none = { type: "fjJudge", turn: f.currentTurn(), selection: [] };
    // 5 sockets from ONE device (same key) vote "select everything"…
    for (let i = 0; i < 5; i++) f.onInput(`sock${i}`, all, true, "ip-A");
    // …two genuine devices vote "select nothing"
    f.onInput("real1", none, true, "ip-B");
    f.onInput("real2", none, true, "ip-C");
    f.onTimeout(); // resolve: 1 voice for `all` vs 2 for `none` → majority = none
    const runner = (pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>).runners.find(
      (r) => r.id === AUDIENCE_RUNNER_ID,
    )!;
    // "none selected" scores only the non-fitting options; under rand()=0 all
    // 3 assigned options FIT, so the sybil-diluted majority moved 0 spaces.
    expect(runner.lastMove).toBe(0);
  });

  it("audience votes on the turn never early-resolve it", () => {
    const f = makeFinale({ audience: true });
    f.onTimeout(); // judge
    judgePerfect(f, "L");
    judgePerfect(f, "g1");
    judgePerfect(f, "g2");
    // all players locked but audience racing → still judging
    const p = pub(f) as Extract<FinalePublic, { kind: "finaleTurn" }>;
    expect(p.sub).toBe("judge");
  });
});

describe("AakhriDarwazaFinale — simulation suite (M4 DoD)", () => {
  /** Deterministic LCG for reproducible random sims. */
  function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("200 randomized finales all terminate with a crowned winner and sane state", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = lcg(seed);
      const nGhosts = Math.floor(rand() * 7); // 0..6 ghosts
      const ghosts = Array.from({ length: nGhosts }, (_, i) => entrant(`g${i}`, Math.floor(rand() * 9000)));
      const f = new AakhriDarwazaFinale(entrant("L", 4000), ghosts, [cat(1), cat(2), cat(3)], {
        rand,
        audience: rand() < 0.3,
      });
      f.onTimeout(); // intro → judge
      let steps = 0;
      while (!f.isOverPhase() && steps < 500) {
        steps += 1;
        // Random behavior each turn: some runners judge (randomly well),
        // some idle. Audience sometimes votes.
        const p = f.publicPhase();
        if (p.kind === "finaleTurn" && p.sub === "judge") {
          for (const r of p.runners) {
            if (r.eliminated || r.distance <= 0) continue;
            if (r.kind === "audience") {
              if (rand() < 0.7) {
                const priv = f.privateFor("member1", true);
                const sel = (priv.options ?? []).filter(() => rand() < 0.5).map((o) => o.index);
                f.onInput("member1", { type: "fjJudge", turn: f.currentTurn(), selection: sel }, true);
              }
            } else if (rand() < 0.8) {
              const priv = f.privateFor(r.id);
              const sel = (priv.options ?? []).filter(() => rand() < 0.6).map((o) => o.index);
              f.onInput(r.id, { type: "fjJudge", turn: f.currentTurn(), selection: sel });
            }
          }
        }
        f.onTimeout();
      }
      // Invariants: terminates, has a winner, positions within track bounds.
      expect(f.isOverPhase(), `seed ${seed} did not terminate`).toBe(true);
      expect(f.winnerId(), `seed ${seed} has no crown`).not.toBeNull();
      const finalPub = f.publicPhase();
      if (finalPub.kind === "finaleTurn") {
        for (const r of finalPub.runners) {
          expect(r.distance).toBeGreaterThanOrEqual(0);
          expect(r.distance).toBeLessThanOrEqual(FINALE_DARKNESS_START);
        }
      }
    }
  });

  it("a perfect living player always escapes before the darkness in a solo race", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const f = new AakhriDarwazaFinale(entrant("L", 0), [], [cat()], { rand: lcg(seed) });
      f.onTimeout();
      let steps = 0;
      while (!f.isOverPhase() && steps < 100) {
        steps += 1;
        const p = f.publicPhase();
        if (p.kind === "finaleTurn" && p.sub === "judge") judgePerfect(f, "L");
        else f.onTimeout();
      }
      expect(f.didEscape(), `seed ${seed}`).toBe(true);
      expect(f.winnerId()).toBe("L");
    }
  });
});
