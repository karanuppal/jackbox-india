import { describe, expect, it } from "vitest";
import type { FinaleCategory, Question, KsPublicPhase } from "@tamasha/shared";
import { KhooniSawaalEngine } from "../src/game/khooniSawaal.js";
import type { GameContext } from "../src/game/engine.js";

// Deterministic question bank: 12 questions, correct index cycles for clarity.
function bank(n = 12): Question[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q_${String(i + 1).padStart(4, "0")}`,
    text: `Sawaal number ${i + 1} kya hai?`,
    textRoman: true,
    options: ["ek", "do", "teen", "chaar"] as [string, string, string, string],
    correct: 0,
    categories: ["food"] as Question["categories"],
    difficulty: 1,
    adult: false,
    vo: `q_${String(i + 1).padStart(4, "0")}.ogg`,
    source: "test fixture bank",
    era: "evergreen" as const,
  }));
}

const meta = { role: "player" as const, active: true };

/** A finale category where options 0..3 fit and 4..7 don't. */
function finaleCat(id: number): FinaleCategory {
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

function makeEngine(
  playerIds: string[],
  opts?: {
    skipTutorial?: boolean;
    timerMode?: "normal" | "extended" | "off";
    rand?: () => number;
    finale?: boolean;
    audienceCount?: number;
  },
) {
  let t = 1000;
  const clock = { now: () => t, set: (v: number) => (t = v), advance: (d: number) => (t += d) };
  const engine = new KhooniSawaalEngine(bank(), {
    // deterministic: take first n, keep order
    pickQuestions: (b, count) => b.slice(0, count),
    // deterministic kamra/wheel randomness (defaults to always-0: first
    // minigame in the pool, wheel always lands on death)
    rand: opts?.rand ?? (() => 0),
    // M4: finale opt-in per test (older tests exercise the no-finale fallback)
    ...(opts?.finale === true ? { finaleCategories: [finaleCat(1)] } : {}),
  });
  const ctx: GameContext = {
    players: playerIds.map((id) => ({ id, name: id, avatar: 0 })),
    settings: {
      familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true,
      timerMode: opts?.timerMode ?? "normal", reducedMotion: false, audienceEnabled: true,
      password: null, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: opts?.skipTutorial ?? false,
    },
    now: clock.now,
    audienceCount: () => opts?.audienceCount ?? 0,
  };
  const first = engine.start(ctx);
  return { engine, clock, first };
}

const answer = (qid: string, idx: number) => ({ type: "answer", questionId: qid, optionIndex: idx });
function pub(engine: KhooniSawaalEngine): KsPublicPhase {
  return engine.publicPhaseData();
}

/** Drive timeouts until the engine leaves the khooniKamra phase (a visit is
 *  at most intro → play → vote → result = 4 timeouts). */
function driveKamra(engine: KhooniSawaalEngine) {
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = engine.onTimeout();
    if (last === null || last.phase !== "khooniKamra") break;
  }
  return last;
}

describe("KhooniSawaalEngine — flow", () => {
  it("starts in the tutorial and advances to question 1 on timeout", () => {
    const { engine, first } = makeEngine(["a", "b"]);
    expect(first.phase).toBe("tutorial");
    expect(pub(engine).kind).toBe("tutorial");
    const next = engine.onTimeout();
    expect(next?.phase).toBe("question");
    const p = pub(engine);
    expect(p.kind).toBe("question");
    if (p.kind === "question") {
      expect(p.number).toBe(1);
      expect(p.total).toBe(10);
      expect(p.questionId).toBe("q_0001");
    }
  });

  it("skips the tutorial when the setting is on", () => {
    const { first, engine } = makeEngine(["a"], { skipTutorial: true });
    expect(first.phase).toBe("question");
    expect(pub(engine).kind).toBe("question");
  });
});

describe("KhooniSawaalEngine — scoring & death", () => {
  it("awards 1000 for correct and sentences a wrong living player to the Khooni Kamra (§3.4)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // → question 1 (correct = 0)
    const qid = "q_0001";
    engine.onAction("a", answer(qid, 0), meta); // correct
    const next = engine.onAction("b", answer(qid, 2), meta); // wrong → all answered → reveal
    expect(next?.phase).toBe("reveal");
    expect(engine.playerState("a")).toEqual({ alive: true, money: 1000, answered: true });
    // b is sentenced, NOT dead yet — the kamra decides (§3.4)
    expect(engine.playerState("b")!.alive).toBe(true);
    const r = pub(engine);
    if (r.kind === "reveal") {
      expect(r.deaths).toEqual([]); // nobody dies AT the reveal in M3
      expect(r.floor).toEqual(["b"]);
      expect(r.mercy).toBe(false);
      expect(r.allCorrect).toBe(false);
      expect(r.correct).toBe(0);
    }
    // reveal timeout → khooniKamra (solo floor → luck/skill game)
    const kamra = engine.onTimeout();
    expect(kamra?.phase).toBe("khooniKamra");
    expect(pub(engine).kind).toBe("kamraIntro");
    // b never plays → solo math score 0 < survival bar → dies in the kamra
    const after = driveKamra(engine);
    expect(after?.phase).toBe("question"); // game moves on to question 2
    expect(engine.playerState("b")!.alive).toBe(false);
  });

  it("mercy rule: if ALL living players are wrong, nobody dies", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout();
    const qid = "q_0001";
    engine.onAction("a", answer(qid, 1), meta);
    engine.onAction("b", answer(qid, 2), meta);
    const r = pub(engine);
    expect(engine.playerState("a")!.alive).toBe(true);
    expect(engine.playerState("b")!.alive).toBe(true);
    if (r.kind === "reveal") {
      expect(r.mercy).toBe(true);
      expect(r.deaths).toEqual([]);
    }
  });

  it("all-correct: nobody dies and it is flagged", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout();
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 0), meta);
    const r = pub(engine);
    if (r.kind === "reveal") {
      expect(r.allCorrect).toBe(true);
      expect(r.deaths).toEqual([]);
    }
    expect(engine.playerState("a")!.money).toBe(1000);
    expect(engine.playerState("b")!.money).toBe(1000);
  });

  it("ghosts keep earning money for correct answers", () => {
    const { engine } = makeEngine(["a", "b", "c"]); // 3 players so death doesn't end it
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // a correct
    engine.onAction("b", answer("q_0001", 0), meta); // b correct
    engine.onAction("c", answer("q_0001", 3), meta); // c wrong → sentenced
    engine.onTimeout(); // reveal → khooniKamra
    driveKamra(engine); // c never plays the solo game → dies → q2
    expect(engine.playerState("c")!.alive).toBe(false);
    engine.onAction("a", answer("q_0002", 0), meta);
    engine.onAction("b", answer("q_0002", 0), meta);
    engine.onAction("c", answer("q_0002", 0), meta); // ghost answers correctly
    expect(engine.playerState("c")!.money).toBe(1000); // earned as a ghost
  });

  it("times out unanswered players as wrong (sentenced, then dies in the kamra)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // a correct; b never answers
    const next = engine.onTimeout(); // question timer elapses → reveal
    expect(next?.phase).toBe("reveal");
    const r = pub(engine);
    if (r.kind === "reveal") expect(r.floor).toEqual(["b"]); // unanswered = wrong = sentenced
    engine.onTimeout(); // → khooniKamra
    driveKamra(engine);
    expect(engine.playerState("b")!.alive).toBe(false);
  });

  it("rejects stale answers for a prior question and double-answers", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout();
    expect(engine.onAction("a", answer("q_9999", 0), meta)).toBeNull(); // wrong qid ignored
    engine.onAction("a", answer("q_0001", 0), meta);
    // second answer from a is ignored (locked)
    engine.onAction("a", answer("q_0001", 2), meta);
    expect(engine.playerState("a")!.answered).toBe(true);
    // audience/unknown player ignored
    expect(engine.onAction("zzz", answer("q_0001", 0), meta)).toBeNull();
  });
});

describe("KhooniSawaalEngine — termination", () => {
  it("does NOT end early when attrited to one alive — plays to the budget (QA-M2-3)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // correct
    engine.onAction("b", answer("q_0001", 3), meta); // wrong → sentenced
    engine.onTimeout(); // reveal → khooniKamra
    const next = driveKamra(engine); // b dies on the floor
    expect(engine.playerState("b")!.alive).toBe(false);
    expect(next?.phase).toBe("question"); // continues despite 1 alive
    expect(engine.isOver()).toBe(false);
  });

  it("a solo game plays all 10 questions (§3.2 fully playable solo)", () => {
    const { engine } = makeEngine(["solo"]);
    engine.onTimeout(); // q1
    let lastPhase = "question";
    for (let q = 1; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      const res = engine.onAction("solo", answer(qid, q % 2 === 0 ? 3 : 0), meta); // alternate right/wrong
      // solo player: wrong = all-living-wrong = mercy, never dies
      expect(res?.phase).toBe("reveal");
      const after = engine.onTimeout();
      lastPhase = after!.phase;
      if (q < 10) expect(lastPhase).toBe("question");
    }
    expect(lastPhase).toBe("gameOver");
    expect(engine.playerState("solo")!.alive).toBe(true); // survived via mercy
  });

  it("budget exhausted with 2+ alive → Maut Ka Chakra spins until one remains (§3.3)", () => {
    // default rand()=0 → every spin lands on death
    const { engine } = makeEngine(["a", "b", "c"]);
    engine.onTimeout(); // q1
    // play 10 questions; everyone answers correctly (all-correct, no deaths)
    for (let q = 1; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      engine.onAction("a", answer(qid, 0), meta);
      engine.onAction("b", answer(qid, 0), meta);
      const res = engine.onAction("c", answer(qid, 0), meta); // → reveal
      expect(res?.phase).toBe("reveal");
      const after = engine.onTimeout(); // reveal → next question or the wheel
      if (q < 10) expect(after?.phase).toBe("question");
      else expect(after?.phase).toBe("wheel");
    }
    // a spins: land (death) + apply → b spins: land (death) + apply → 1 alive
    let w = pub(engine);
    if (w.kind === "wheel") {
      expect(w.spinnerId).toBe("a");
      expect(w.outcome).toBeNull();
    }
    engine.onTimeout(); // a's spin lands
    w = pub(engine);
    if (w.kind === "wheel") expect(w.outcome).toBe("death");
    engine.onTimeout(); // applied: a dead, wheel passes to b
    expect(engine.playerState("a")!.alive).toBe(false);
    engine.onTimeout(); // b's spin lands (death)
    const end = engine.onTimeout(); // applied: b dead → 1 alive → gameOver
    expect(end?.phase).toBe("gameOver");
    expect(engine.isOver()).toBe(true);
    const go = pub(engine);
    if (go.kind === "gameOver") {
      expect(go.standings).toHaveLength(3);
      expect(go.winnerId).toBe("c"); // the last one standing
    }
  });

  it("the wheel can land on life (1-in-6) and pass the spin on (§3.3)", () => {
    // rand sequence: q-pick unaffected; wheel: first spin life, second death, third death
    const outcomes = [0.99, 0, 0]; // 0.99*6 = 5.94 ≥ 5 → life; 0 → death
    let i = 0;
    const { engine } = makeEngine(["a", "b"], { rand: () => outcomes[i++ % outcomes.length]! });
    engine.onTimeout(); // q1
    for (let q = 1; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      engine.onAction("a", answer(qid, 0), meta);
      engine.onAction("b", answer(qid, 0), meta);
      engine.onTimeout(); // reveal → next / wheel
    }
    expect(pub(engine).kind).toBe("wheel");
    engine.onTimeout(); // a's spin lands: LIFE
    let w = pub(engine);
    if (w.kind === "wheel") expect(w.outcome).toBe("life");
    engine.onTimeout(); // applied: a survives, wheel passes to b
    expect(engine.playerState("a")!.alive).toBe(true);
    w = pub(engine);
    if (w.kind === "wheel") expect(w.spinnerId).toBe("b");
    engine.onTimeout(); // b's spin lands: DEATH
    const end = engine.onTimeout(); // applied → 1 alive → gameOver
    expect(end?.phase).toBe("gameOver");
    const go = pub(engine);
    if (go.kind === "gameOver") expect(go.winnerId).toBe("a");
  });
});

describe("KhooniSawaalEngine — timers", () => {
  it("extended timer mode doubles the question window", () => {
    const { engine, clock } = makeEngine(["a"], { timerMode: "extended" });
    const q = engine.onTimeout(); // → question with deadline
    expect(q?.deadline).toBe(clock.now() + 60000); // 30s * 2
  });

  it("no-timer mode leaves the question untimed (resolves only when all answer)", () => {
    const { engine } = makeEngine(["a", "b"], { timerMode: "off" });
    const q = engine.onTimeout(); // → question
    expect(q?.deadline).toBeNull();
    engine.onAction("a", answer("q_0001", 0), meta);
    const still = pub(engine);
    expect(still.kind).toBe("question"); // not resolved until everyone answers
    const done = engine.onAction("b", answer("q_0001", 0), meta);
    expect(done?.phase).toBe("reveal");
  });
});

describe("KhooniSawaalEngine — snapshots & edges", () => {
  it("progress() is zero outside rounds and correct during them", () => {
    const { engine } = makeEngine(["a"]);
    expect(engine.progress()).toEqual({ number: 0, total: 0 }); // tutorial
    engine.onTimeout(); // q1
    expect(engine.progress()).toEqual({ number: 1, total: 10 });
  });

  it("playerState returns null for unknown players (audience)", () => {
    const { engine } = makeEngine(["a"]);
    expect(engine.playerState("zzz")).toBeNull();
  });

  it("gameOver standings put alive players ahead of ghosts, then by money", () => {
    const { engine } = makeEngine(["a", "b", "c"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // correct, alive, 1000
    engine.onAction("b", answer("q_0001", 0), meta); // correct, alive, 1000
    engine.onAction("c", answer("q_0001", 3), meta); // wrong → ghost
    // drive to game over by exhausting: everyone correct through q10
    engine.onTimeout(); // reveal → q2
    for (let q = 2; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      engine.onAction("a", answer(qid, 0), meta);
      engine.onAction("b", answer(qid, 1), meta); // b now wrong-ish but mercy may apply
      engine.onAction("c", answer(qid, 0), meta);
      engine.onTimeout(); // reveal → next/gameOver
    }
    const go = pub(engine);
    if (go.kind === "gameOver") {
      // ghost c must not rank above an alive player
      const aliveIdx = go.standings.findIndex((s) => s.alive);
      const ghostIdx = go.standings.findIndex((s) => !s.alive);
      if (ghostIdx !== -1 && aliveIdx !== -1) expect(aliveIdx).toBeLessThan(ghostIdx);
    }
  });

  it("privatePhaseData reflects the caller's own answer and liveness", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 2), meta);
    const priv = engine.privatePhaseData("a");
    expect(priv.answered).toBe(true);
    expect(priv.myAnswer).toBe(2);
    expect(engine.privatePhaseData("zzz").answered).toBe(false);
  });
});

describe("KhooniSawaalEngine — M2 fixes", () => {
  it("no-timer round resolves when a non-answering player forfeits on disconnect (QA-M2-2/SEC-M2-1)", () => {
    const { engine } = makeEngine(["a", "b"], { timerMode: "off" });
    engine.onTimeout(); // q1, untimed (deadline null)
    engine.onAction("a", answer("q_0001", 0), meta); // a answers; b never does
    expect(engine.publicPhaseData().kind).toBe("question"); // stuck without forfeit
    const next = engine.onPlayerLeft("b"); // b disconnects → forfeit → resolve
    expect(next?.phase).toBe("reveal");
    const r = pub(engine);
    if (r.kind === "reveal") expect(r.floor).toEqual(["b"]); // forfeit scored wrong → sentenced
    engine.onTimeout(); // → khooniKamra (always timed, even in off mode)
    const after = driveKamra(engine); // absent player never plays → dies
    expect(after?.phase).toBe("question");
    expect(engine.playerState("b")!.alive).toBe(false);
  });

  it("onPlayerLeft is a no-op outside a question or for an already-answered player", () => {
    const { engine } = makeEngine(["a", "b"]);
    expect(engine.onPlayerLeft("a")).toBeNull(); // still in tutorial
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta);
    expect(engine.onPlayerLeft("a")).toBeNull(); // already answered
    expect(engine.onPlayerLeft("zzz")).toBeNull(); // unknown
  });

  it("family-friendly fallback never serves adult content — ends gracefully (QA-M2-R1)", () => {
    // an all-adult bank + family-friendly ON → filtered fallback is empty too →
    // gameOver rather than serving adult questions
    const adultBank: Question[] = bank(3).map((q) => ({ ...q, adult: true }));
    const ffEngine = new KhooniSawaalEngine(adultBank, { pickQuestions: (_b, _n, ff) => (ff ? [] : _b.slice(0, _n)) });
    const first = ffEngine.start({
      players: [{ id: "a", name: "a", avatar: 0 }],
      settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, password: null, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: true },
      now: () => 1000,
    });
    expect(first.phase).toBe("gameOver"); // no adult questions served in FF mode
    // with the filter OFF, the same bank plays via the fallback
    const openEngine = new KhooniSawaalEngine(adultBank, { pickQuestions: () => [] });
    const openFirst = openEngine.start({
      players: [{ id: "a", name: "a", avatar: 0 }],
      settings: { familyFriendly: false, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, password: null, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: true },
      now: () => 1000,
    });
    expect(openFirst.phase).toBe("question");
  });

  it("ends gracefully (gameOver) when the bank is truly empty", () => {
    const engine = new KhooniSawaalEngine([], { pickQuestions: () => [] });
    const first = engine.start({
      players: [{ id: "a", name: "a", avatar: 0 }],
      settings: { familyFriendly: false, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, password: null, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
      now: () => 1000,
    });
    expect(first.phase).toBe("gameOver");
    expect(engine.isOver()).toBe(true);
  });

  it("rejects a malformed answer payload via the shared schema (QA-M2-7)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    expect(engine.onAction("a", { type: "answer", questionId: "q_0001", optionIndex: "0" }, meta)).toBeNull();
    expect(engine.onAction("a", { type: "answer", questionId: "bad", optionIndex: 0 }, meta)).toBeNull();
    expect(engine.onAction("a", { nope: true }, meta)).toBeNull();
    expect(engine.playerState("a")!.answered).toBe(false);
  });
});

describe("KhooniSawaalEngine — M3 Khooni Kamra", () => {
  it("mercy sends nobody to the kamra — straight to the next question", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 1), meta); // wrong
    engine.onAction("b", answer("q_0001", 2), meta); // wrong → all living wrong = mercy
    const r = pub(engine);
    if (r.kind === "reveal") {
      expect(r.mercy).toBe(true);
      expect(r.floor).toEqual([]);
    }
    const after = engine.onTimeout(); // reveal → next question, NO kamra
    expect(after?.phase).toBe("question");
    expect(engine.playerState("a")!.alive).toBe(true);
    expect(engine.playerState("b")!.alive).toBe(true);
  });

  it("a solo floor player can SURVIVE a luck/skill game (§3.4): 3 correct sums", () => {
    const { engine } = makeEngine(["a", "b"]); // rand()=0 → solo pool → Hisaab-Kitaab
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // correct
    engine.onAction("b", answer("q_0001", 3), meta); // wrong → sentenced solo
    engine.onTimeout(); // reveal → khooniKamra (intro)
    expect(pub(engine).kind).toBe("kamraIntro");
    engine.onTimeout(); // intro → play
    expect(pub(engine).kind).toBe("kamraPlay");
    // b's private math question is deterministic under rand()=0: 2 + 2
    // (operands floor at 2, UT-M4-5)
    const priv = engine.privatePhaseData("b");
    expect(priv.kamra?.onFloor).toBe(true);
    expect(priv.kamra?.data).toEqual({ a: 2, b: 2, op: "+", score: 0, soloBar: 3 });
    // three correct answers clears the solo survival bar (§3.4)
    engine.onAction("b", { type: "kmMath", value: 4 }, meta);
    engine.onAction("b", { type: "kmMath", value: 4 }, meta);
    engine.onAction("b", { type: "kmMath", value: 4 }, meta);
    const after = driveKamra(engine); // play timeout → result (no deaths) → next q
    expect(after?.phase).toBe("question");
    expect(engine.playerState("b")!.alive).toBe(true); // survived the kamra
    expect(engine.playerState("b")!.money).toBe(75); // §3.7: ₹25 × 3 correct
  });

  it("voting game: submissions, votes, VIP censor, and the worst answer dies", () => {
    // uuids because kmVote/censor targetIds are schema-validated as uuids
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // rand()=0.5 → MINIGAME_KINDS[4] = sabseGhatiyaJawaab (floor 2 + 1 voter)
    const { engine } = makeEngine([A, B, C], { rand: () => 0.5 });
    engine.onTimeout(); // q1
    engine.onAction(A, answer("q_0001", 1), meta); // wrong → floor
    engine.onAction(B, answer("q_0001", 2), meta); // wrong → floor
    engine.onAction(C, answer("q_0001", 0), meta); // correct → voter
    engine.onTimeout(); // reveal → kamra intro
    engine.onTimeout(); // intro → play
    expect(pub(engine).kind).toBe("kamraPlay");
    // floor submits answers; early-advance to the vote when both lock in
    engine.onAction(A, { type: "kmAnswer", text: "chai peelo" }, meta);
    const adv = engine.onAction(B, { type: "kmAnswer", text: "ghatiya jawab" }, meta);
    expect(adv?.phase).toBe("khooniKamra"); // sub-phase changed → new deadline
    expect(pub(engine).kind).toBe("kamraVote");
    // the VIP censors A's submission — content hidden, entry stays on the
    // ballot as a blank card (UT-M3-2)
    expect(engine.onAction(C, { type: "censor", targetId: A }, { ...meta, vip: true })).toBeNull();
    const vote = pub(engine);
    if (vote.kind === "kamraVote") {
      const entryA = vote.entries.find((e) => e.playerId === A)!;
      expect(entryA.censored).toBe(true);
      expect(entryA.text).toBeNull();
    }
    // a non-VIP cannot censor
    engine.onAction(C, { type: "censor", targetId: B }, { ...meta, vip: false });
    const vote2 = pub(engine);
    if (vote2.kind === "kamraVote") {
      expect(vote2.entries.find((e) => e.playerId === B)?.censored).toBe(false);
    }
    // the last outstanding voter votes against B → the polls close EARLY
    const closed = engine.onAction(C, { type: "kmVote", targetId: B }, meta);
    expect(closed?.phase).toBe("khooniKamra"); // sub-phase advanced → new deadline
    const res = pub(engine);
    expect(res.kind).toBe("kamraResult");
    if (res.kind === "kamraResult") {
      expect(res.deaths).toEqual([B]);
      expect(res.survivors).toEqual([A]);
    }
    const after = engine.onTimeout(); // result → next question
    expect(after?.phase).toBe("question");
    expect(engine.playerState(B)!.alive).toBe(false);
    expect(engine.playerState(A)!.alive).toBe(true);
  });

  it("floor players cannot vote and ghosts cannot play the minigame", () => {
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const { engine } = makeEngine([A, B, C], { rand: () => 0.5 }); // sabseGhatiyaJawaab
    engine.onTimeout();
    engine.onAction(A, answer("q_0001", 1), meta);
    engine.onAction(B, answer("q_0001", 2), meta);
    engine.onAction(C, answer("q_0001", 0), meta);
    engine.onTimeout(); // → intro
    engine.onTimeout(); // → play
    // the voter (not on the floor) cannot submit an answer
    expect(engine.onAction(C, { type: "kmAnswer", text: "nahi" }, meta)).toBeNull();
    engine.onAction(A, { type: "kmAnswer", text: "x" }, meta);
    engine.onAction(B, { type: "kmAnswer", text: "y" }, meta); // → vote
    // floor players cannot vote
    expect(engine.onAction(A, { type: "kmVote", targetId: B }, meta)).toBeNull();
    const v = pub(engine);
    if (v.kind === "kamraVote") {
      expect(v.entries.find((e) => e.playerId === B)?.votesAgainst).toBe(0);
    }
  });

  it("trivia answers are ignored during the kamra; kamra input ignored during questions", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    expect(engine.onAction("a", { type: "kmMath", value: 3 }, meta)).toBeNull(); // not in kamra
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta);
    engine.onTimeout(); // reveal → kamra
    engine.onTimeout(); // intro → play
    expect(engine.onAction("b", answer("q_0001", 0), meta)).toBeNull(); // trivia ignored in kamra
    expect(engine.playerState("b")!.alive).toBe(true); // nothing applied yet
  });

  it("extended/off timer modes DOUBLE kamra play/vote; intro/result stay fixed (QA-M3-7)", () => {
    const { engine, clock } = makeEngine(["a", "b"], { timerMode: "extended" });
    engine.onTimeout(); // q1 (extended: 60s)
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta);
    const kamra = engine.onTimeout(); // reveal → kamra intro
    expect(kamra?.deadline).toBe(clock.now() + 3500); // introMs is presentation — fixed
    const play = engine.onTimeout(); // intro → play
    expect(play?.deadline).toBe(clock.now() + 50000); // 25s × 2 (accessibility)
    // normal mode keeps the standard race timer
    const { engine: e2, clock: c2 } = makeEngine(["a", "b"]);
    e2.onTimeout();
    e2.onAction("a", answer("q_0001", 0), meta);
    e2.onAction("b", answer("q_0001", 3), meta);
    e2.onTimeout(); // → intro
    const p2 = e2.onTimeout(); // → play
    expect(p2?.deadline).toBe(c2.now() + 25000);
  });

  it("kmAnswer text is sanitized and profanity-filtered before the shared screen (SEC-M3-1/QA-M3-6)", () => {
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const { engine } = makeEngine([A, B, C], { rand: () => 0.5 }); // sabseGhatiyaJawaab
    engine.onTimeout(); // q1
    engine.onAction(A, answer("q_0001", 1), meta);
    engine.onAction(B, answer("q_0001", 2), meta);
    engine.onAction(C, answer("q_0001", 0), meta);
    engine.onTimeout(); // → intro
    engine.onTimeout(); // → play
    // bidi-override + zero-width injection is stripped before storage
    engine.onAction(A, { type: "kmAnswer", text: "chai‮ lo​" }, meta);
    // default profanityFilter is STRICT → a profane answer is rejected outright
    expect(engine.onAction(B, { type: "kmAnswer", text: "kya chutiya prompt hai" }, meta)).toBeNull();
    expect(engine.privatePhaseData(B).kamra?.done).toBe(false);
    // an invisible-only answer is rejected too
    expect(engine.onAction(B, { type: "kmAnswer", text: "​​" }, meta)).toBeNull();
    engine.onAction(B, { type: "kmAnswer", text: "theek hai" }, meta); // → vote
    const v = pub(engine);
    if (v.kind === "kamraVote") {
      const entryA = v.entries.find((e) => e.playerId === A);
      expect(entryA?.text).toBe("chai lo"); // sanitized, no bidi/zero-width
    }
  });

  it("minigames rotate without repeats until all legal ones are seen (LRU §3.4)", () => {
    // Multi-player floors with no voters (2 players, both wrong is mercy —
    // so use 3 players where 2 are wrong each round; the third is the voter).
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const { engine } = makeEngine([A, B, C, D], { rand: () => 0 });
    engine.onTimeout(); // q1
    const seen: string[] = [];
    // Visit 1: A+B on the floor (both idle → both die). Visit 2: C solo floor.
    engine.onAction(A, answer("q_0001", 1), meta);
    engine.onAction(B, answer("q_0001", 2), meta);
    engine.onAction(C, answer("q_0001", 0), meta);
    engine.onAction(D, answer("q_0001", 0), meta);
    engine.onTimeout(); // → kamra intro (visit 1)
    const p1 = pub(engine);
    if (p1.kind === "kamraIntro") seen.push(p1.minigame);
    driveKamra(engine);
    // next question: C wrong this time (solo floor), D correct
    const q2 = "q_0002";
    engine.onAction(A, answer(q2, 0), meta);
    engine.onAction(B, answer(q2, 0), meta);
    engine.onAction(C, answer(q2, 1), meta);
    engine.onAction(D, answer(q2, 0), meta);
    engine.onTimeout(); // → kamra intro (visit 2)
    const p2 = pub(engine);
    if (p2.kind === "kamraIntro") seen.push(p2.minigame);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]); // LRU: no repeat while fresh games remain
  });
});

describe("KhooniSawaalEngine — M4 Aakhri Darwaza integration", () => {
  /** Perfect-judge helper: select exactly the assigned fitting options. */
  function judgePerfect(engine: KhooniSawaalEngine, id: string) {
    const priv = engine.privatePhaseData(id);
    const fits = ["Duplicate", "Don", "Fan", "Ra.One"];
    const sel = (priv.finale?.options ?? []).filter((o) => fits.includes(o.text)).map((o) => o.index);
    const p = pub(engine);
    const turn = p.kind === "finaleTurn" ? p.turn : 0;
    return engine.onAction(id, { type: "fjJudge", turn, selection: sel }, meta);
  }

  it("attrition to one living player starts the finale immediately (§3.3)", () => {
    const { engine } = makeEngine(["a", "b"], { finale: true });
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta); // wrong → kamra
    engine.onTimeout(); // reveal → kamra
    const next = driveKamra(engine); // b dies → 1 alive → FINALE, not question 2
    expect(next?.phase).toBe("finaleIntro");
    const p = pub(engine);
    expect(p.kind).toBe("finaleIntro");
    if (p.kind === "finaleIntro") {
      expect(p.runners.find((r) => r.id === "a")?.kind).toBe("living");
      expect(p.runners.find((r) => r.id === "b")?.kind).toBe("ghost");
    }
  });

  it("the wheel hands over to the finale once one player remains", () => {
    const { engine } = makeEngine(["a", "b", "c"], { finale: true });
    engine.onTimeout(); // q1
    for (let q = 1; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      engine.onAction("a", answer(qid, 0), meta);
      engine.onAction("b", answer(qid, 0), meta);
      engine.onAction("c", answer(qid, 0), meta);
      engine.onTimeout(); // reveal → next / wheel
    }
    expect(pub(engine).kind).toBe("wheel");
    // rand()=0 → every spin is death: a dies, b dies → finale for c
    engine.onTimeout(); engine.onTimeout(); // a: land + apply
    engine.onTimeout(); // b: land
    const fin = engine.onTimeout(); // b: apply → 1 alive → finale
    expect(fin?.phase).toBe("finaleIntro");
    expect(engine.isOver()).toBe(false);
  });

  it("a perfect living player escapes and wins the whole game (§3.6)", () => {
    const { engine } = makeEngine(["a", "b"], { finale: true });
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta);
    engine.onTimeout(); // → kamra
    driveKamra(engine); // b dies → finaleIntro
    engine.onTimeout(); // intro → judge turn 1
    expect(pub(engine).kind).toBe("finaleTurn");
    // drive perfect turns until escape (14 spaces / 2 per turn = 7 turns; b
    // the ghost never judges and gets eaten by the darkness eventually)
    let guard = 0;
    while (!engine.isOver() && guard < 40) {
      guard += 1;
      const p = pub(engine);
      if (p.kind === "finaleTurn" && p.sub === "judge") {
        judgePerfect(engine, "a");
        // the ghost never judges, so the turn resolves on its 12s timer
        const after = pub(engine);
        if (after.kind === "finaleTurn" && after.sub === "judge") engine.onTimeout();
      } else {
        engine.onTimeout();
      }
    }
    expect(engine.isOver()).toBe(true);
    const go = pub(engine);
    if (go.kind === "gameOver") {
      expect(go.winnerId).toBe("a");
      expect(go.finale?.escaped).toBe(true);
      expect(go.standings.find((s) => s.playerId === "a")?.alive).toBe(true);
    }
  });

  it("without finale categories the M3 endings stand (back-compat)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta);
    engine.onTimeout();
    const next = driveKamra(engine); // b dies → 1 alive but NO finale configured
    expect(next?.phase).toBe("question"); // plays on to the budget (M3 rules)
  });

  it("finale private data flows to racers; audience runner appears when enabled + present", () => {
    const { engine } = makeEngine(["a", "b"], { finale: true, audienceCount: 5 });
    engine.onTimeout();
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta);
    engine.onTimeout();
    driveKamra(engine); // → finaleIntro
    const p = pub(engine);
    if (p.kind === "finaleIntro") {
      expect(p.runners.some((r) => r.kind === "audience")).toBe(true);
    }
    engine.onTimeout(); // → judge
    const privA = engine.privatePhaseData("a");
    expect(privA.finale?.racing).toBe(true);
    expect(privA.finale?.options?.length).toBeGreaterThan(0);
    // an audience member (unknown player id) gets the audience runner's options
    const audPriv = engine.privatePhaseData("watcher-1");
    expect(audPriv.finale?.racing).toBe(true);
  });
});

describe("KhooniSawaalEngine — first-visit luck softening (fleet)", () => {
  it("a first-time solo floor avoids the pure-luck chai; veterans can draw it", () => {
    // rand ≈ 0.9: solo pool [hisaab, spelling, chai] → index 2 = chai.
    // With the first-visit avoidance the pool is [hisaab, spelling] → spelling.
    const { engine } = makeEngine(["a", "b"], { rand: () => 0.9 });
    engine.onTimeout(); // q1 (correct = 0)
    engine.onAction("a", answer("q_0001", 0), meta);
    engine.onAction("b", answer("q_0001", 3), meta); // b's FIRST sentencing
    engine.onTimeout(); // → kamra intro
    const p1 = pub(engine);
    if (p1.kind === "kamraIntro") expect(p1.minigame).not.toBe("zeharWaliChai");
  });
});

describe("KhooniSawaalEngine — M2 fixes (schema)", () => {
  it("rejects malformed payload variants (QA-M2-7 recheck)", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    expect(engine.onAction("a", { type: "answer", questionId: "q_0001", optionIndex: "0" }, meta)).toBeNull();
    expect(engine.onAction("a", { type: "answer", questionId: "bad", optionIndex: 0 }, meta)).toBeNull();
    expect(engine.onAction("a", { nope: true }, meta)).toBeNull();
    expect(engine.playerState("a")!.answered).toBe(false);
  });
});
