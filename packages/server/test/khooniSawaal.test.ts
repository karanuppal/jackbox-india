import { describe, expect, it } from "vitest";
import type { Question, KsPublicPhase } from "@tamasha/shared";
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

function makeEngine(playerIds: string[], opts?: { skipTutorial?: boolean; timerMode?: "normal" | "extended" | "off" }) {
  let t = 1000;
  const clock = { now: () => t, set: (v: number) => (t = v), advance: (d: number) => (t += d) };
  const engine = new KhooniSawaalEngine(bank(), {
    // deterministic: take first n, keep order
    pickQuestions: (b, count) => b.slice(0, count),
  });
  const ctx: GameContext = {
    players: playerIds.map((id) => ({ id, name: id, avatar: 0 })),
    settings: {
      familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true,
      timerMode: opts?.timerMode ?? "normal", reducedMotion: false, audienceEnabled: true,
      password: null, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: opts?.skipTutorial ?? false,
    },
    now: clock.now,
  };
  const first = engine.start(ctx);
  return { engine, clock, first };
}

const answer = (qid: string, idx: number) => ({ type: "answer", questionId: qid, optionIndex: idx });
function pub(engine: KhooniSawaalEngine): KsPublicPhase {
  return engine.publicPhaseData();
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
  it("awards 1000 for correct and kills a wrong living player", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // → question 1 (correct = 0)
    const qid = "q_0001";
    engine.onAction("a", answer(qid, 0), meta); // correct
    const next = engine.onAction("b", answer(qid, 2), meta); // wrong → all answered → reveal
    expect(next?.phase).toBe("reveal");
    expect(engine.playerState("a")).toEqual({ alive: true, money: 1000, answered: true });
    expect(engine.playerState("b")).toEqual({ alive: false, money: 0, answered: true });
    const r = pub(engine);
    if (r.kind === "reveal") {
      expect(r.deaths).toEqual(["b"]);
      expect(r.mercy).toBe(false);
      expect(r.allCorrect).toBe(false);
      expect(r.correct).toBe(0);
    }
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
    engine.onAction("c", answer("q_0001", 3), meta); // c wrong → ghost, 2 alive remain
    engine.onTimeout(); // reveal → q2
    expect(engine.playerState("c")!.alive).toBe(false);
    engine.onAction("a", answer("q_0002", 0), meta);
    engine.onAction("b", answer("q_0002", 0), meta);
    engine.onAction("c", answer("q_0002", 0), meta); // ghost answers correctly
    expect(engine.playerState("c")!.money).toBe(1000); // earned as a ghost
  });

  it("times out unanswered players as wrong", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // a correct; b never answers
    const next = engine.onTimeout(); // question timer elapses → reveal
    expect(next?.phase).toBe("reveal");
    expect(engine.playerState("b")!.alive).toBe(false); // unanswered = wrong = death
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
  it("ends when only one player remains alive", () => {
    const { engine } = makeEngine(["a", "b"]);
    engine.onTimeout(); // q1
    engine.onAction("a", answer("q_0001", 0), meta); // correct
    engine.onAction("b", answer("q_0001", 3), meta); // wrong → dead, only a alive
    const next = engine.onTimeout(); // reveal → afterReveal → gameOver (1 alive)
    expect(next?.phase).toBe("gameOver");
    expect(engine.isOver()).toBe(true);
    const go = pub(engine);
    if (go.kind === "gameOver") {
      expect(go.winnerId).toBe("a");
      expect(go.standings[0]!.playerId).toBe("a");
    }
  });

  it("ends after the question budget with survivors, ranked by money", () => {
    const { engine } = makeEngine(["a", "b", "c"]);
    engine.onTimeout(); // q1
    // play 10 questions; everyone answers correctly (all-correct, no deaths)
    for (let q = 1; q <= 10; q++) {
      const qid = `q_${String(q).padStart(4, "0")}`;
      engine.onAction("a", answer(qid, 0), meta);
      engine.onAction("b", answer(qid, 0), meta);
      const res = engine.onAction("c", answer(qid, 0), meta); // → reveal
      expect(res?.phase).toBe("reveal");
      const after = engine.onTimeout(); // reveal → next or gameOver
      if (q < 10) expect(after?.phase).toBe("question");
      else expect(after?.phase).toBe("gameOver");
    }
    expect(engine.isOver()).toBe(true);
    const go = pub(engine);
    if (go.kind === "gameOver") expect(go.standings).toHaveLength(3);
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
