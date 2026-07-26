// Room-level integration for the Khooni Kamra (QA-M3-17): drives a real Room
// (actions + handleTimeout + snapshots) through reveal → kamra sub-phases →
// death, including pause/resume mid-kamra and the reconnect snapshot shape.
import { describe, expect, it } from "vitest";
import { KAMRA_TIMERS, TIMERS, type KamraPrivate, type KsPublicPhase, type Question } from "@tamasha/shared";
import { Room } from "../src/rooms/room.js";
import { KhooniSawaalEngine } from "../src/game/khooniSawaal.js";

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

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (d: number) => (t += d) };
  const room = new Room(
    "TEST",
    () =>
      new KhooniSawaalEngine(bank(), {
        pickQuestions: (b, count) => b.slice(0, count),
        rand: () => 0, // solo floor → Hisaab-Kitaab; deterministic
      }),
    clock.now,
  );
  const a = room.join({ name: "Amma" });
  const b = room.join({ name: "Babu" });
  const c = room.join({ name: "Chhotu" });
  if (!a.ok || !b.ok || !c.ok) throw new Error("joins failed");
  return { room, clock, a: a.playerId!, b: b.playerId!, c: c.playerId! };
}

const answerAction = (qid: string, idx: number) => ({
  action: "game" as const,
  payload: { type: "answer", questionId: qid, optionIndex: idx },
});

function phaseKind(room: Room): string {
  const pd = room.publicState().phaseData as KsPublicPhase | null;
  return pd?.kind ?? "none";
}

describe("Room × Khooni Kamra integration", () => {
  it("runs reveal → intro → play → result → next question through room timeouts, killing the idle floor player", () => {
    const { room, clock, a, b, c } = setup();
    expect(room.applyAction(a, { action: "startGame" })).toBeNull(); // a is VIP
    clock.advance(TIMERS.tutorialMs);
    expect(room.handleTimeout()).toBe(true); // tutorial → q1
    expect(room.getPhase()).toBe("question");

    room.applyAction(a, answerAction("q_0001", 0));
    room.applyAction(b, answerAction("q_0001", 0));
    room.applyAction(c, answerAction("q_0001", 3)); // wrong → sentenced
    expect(room.getPhase()).toBe("reveal");

    clock.advance(TIMERS.revealMs);
    expect(room.handleTimeout()).toBe(true); // reveal → kamra intro
    expect(room.getPhase()).toBe("khooniKamra");
    expect(phaseKind(room)).toBe("kamraIntro");

    // Reconnect-style snapshot: the floor player's private view carries kamra data
    const privC = room.privateView(c, "player").phaseData as { kamra: KamraPrivate | null };
    expect(privC.kamra?.onFloor).toBe(true);
    const privA = room.privateView(a, "player").phaseData as { kamra: KamraPrivate | null };
    expect(privA.kamra?.onFloor).toBe(false);

    clock.advance(KAMRA_TIMERS.introMs);
    expect(room.handleTimeout()).toBe(true); // intro → play
    expect(phaseKind(room)).toBe("kamraPlay");

    clock.advance(KAMRA_TIMERS.playMs);
    expect(room.handleTimeout()).toBe(true); // play → result (idle c scores 0)
    expect(phaseKind(room)).toBe("kamraResult");

    clock.advance(KAMRA_TIMERS.resultMs);
    expect(room.handleTimeout()).toBe(true); // result → question 2
    expect(room.getPhase()).toBe("question");
    const cPub = room.publicState().players.find((p) => p.id === c)!;
    expect(cPub.alive).toBe(false); // died on the killing floor
  });

  it("pause mid-kamra freezes the public deadline (null) and resume restores the countdown (QA-M3-10)", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout();
    room.applyAction(a, answerAction("q_0001", 0));
    room.applyAction(b, answerAction("q_0001", 0));
    room.applyAction(c, answerAction("q_0001", 3));
    clock.advance(TIMERS.revealMs);
    room.handleTimeout(); // → kamra intro
    expect(room.getPhase()).toBe("khooniKamra");
    const deadlineBefore = room.publicState().deadline;
    expect(deadlineBefore).not.toBeNull();

    expect(room.applyAction(null, { action: "pause" })).toBeNull(); // host screen
    expect(room.isPaused()).toBe(true);
    expect(room.publicState().deadline).toBeNull(); // no ticking lie while paused
    clock.advance(60_000);
    expect(room.handleTimeout()).toBe(false); // frozen — no advance while paused
    expect(room.getPhase()).toBe("khooniKamra");

    room.applyAction(null, { action: "resume" });
    const restored = room.publicState().deadline;
    expect(restored).not.toBeNull(); // countdown restored with remaining time
    clock.advance(KAMRA_TIMERS.introMs);
    expect(room.handleTimeout()).toBe(true); // …and it advances again
    expect(phaseKind(room)).toBe("kamraPlay");
  });

  it("a host reload auto-resumes the host-drop pause — the room is never bricked (UT-M3-1)", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout(); // → question
    const deadlineBefore = room.publicState().deadline!;
    room.connectHost(room.hostToken); // host screen attaches
    room.disconnectHost(); // …and reloads (drops)
    expect(room.isPaused()).toBe(true); // auto-pause with frozen remaining
    clock.advance(30_000); // reload takes a while
    expect(room.handleTimeout()).toBe(false); // frozen
    room.connectHost(room.hostToken); // host tab comes back
    expect(room.isPaused()).toBe(false); // pause lifted AUTOMATICALLY
    const restored = room.publicState().deadline!;
    expect(restored - clock.now()).toBe(deadlineBefore - (clock.now() - 30_000)); // remaining preserved
  });

  it("a DELIBERATE host pause survives a host reconnect (only resume lifts it)", () => {
    const { room, clock, a } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout();
    room.connectHost(room.hostToken);
    room.applyAction(null, { action: "pause" }); // deliberate
    room.disconnectHost();
    room.connectHost(room.hostToken); // reconnect must NOT auto-resume
    expect(room.isPaused()).toBe(true);
    room.applyAction(null, { action: "resume" });
    expect(room.isPaused()).toBe(false);
  });

  it("kamra input is frozen while paused (§4.3)", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout();
    room.applyAction(a, answerAction("q_0001", 0));
    room.applyAction(b, answerAction("q_0001", 0));
    room.applyAction(c, answerAction("q_0001", 3));
    clock.advance(TIMERS.revealMs);
    room.handleTimeout(); // → intro
    clock.advance(KAMRA_TIMERS.introMs);
    room.handleTimeout(); // → play
    room.applyAction(null, { action: "pause" });
    expect(
      room.applyAction(c, { action: "game", payload: { type: "kmMath", value: 0 } }),
    ).toBe("NOT_ALLOWED");
  });
});
