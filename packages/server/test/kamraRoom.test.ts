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

// ---------------------------------------------------------------------------
// Room-level finale coverage (QA-M4-5): timer chain, pause mid-finale, and
// the reconnect snapshot carrying FinalePrivate.
// ---------------------------------------------------------------------------
import { FINALE_TIMERS, type FinaleCategory, type FinalePrivate } from "@tamasha/shared";

function finaleCat(): FinaleCategory {
  return {
    id: "f_0001",
    title: "SRK double roles",
    vo: "f_0001.ogg",
    adult: false,
    options: [
      { text: "Duplicate", fits: true },
      { text: "Don", fits: true },
      { text: "Fan", fits: true },
      { text: "Ra.One", fits: true },
      { text: "DDLJ", fits: false },
      { text: "Swades", fits: false },
    ],
    source: "test fixture",
  };
}

function setupFinaleRoom() {
  let t = 2_000_000;
  const clock = { now: () => t, advance: (d: number) => (t += d) };
  const room = new Room(
    "FIN",
    () =>
      new KhooniSawaalEngine(bank(), {
        pickQuestions: (b, count) => b.slice(0, count),
        rand: () => 0,
        finaleCategories: [finaleCat()],
      }),
    clock.now,
  );
  const a = room.join({ name: "Amma" });
  const b = room.join({ name: "Babu" });
  if (!a.ok || !b.ok) throw new Error("joins failed");
  return { room, clock, a: a.playerId!, b: b.playerId! };
}

function driveToFinale(env: ReturnType<typeof setupFinaleRoom>) {
  const { room, clock, a, b } = env;
  room.applyAction(a, { action: "startGame" });
  clock.advance(TIMERS.tutorialMs);
  room.handleTimeout(); // → q1
  room.applyAction(a, answerAction("q_0001", 0));
  room.applyAction(b, answerAction("q_0001", 3)); // b sentenced
  clock.advance(TIMERS.revealMs);
  room.handleTimeout(); // → kamra intro
  clock.advance(KAMRA_TIMERS.introMs);
  room.handleTimeout(); // → play
  clock.advance(KAMRA_TIMERS.playMs * 2); // covers doubled timers just in case
  room.handleTimeout(); // → result (b idle → dies)
  clock.advance(KAMRA_TIMERS.resultMs);
  room.handleTimeout(); // 1 alive → finaleIntro
}

describe("Room × Aakhri Darwaza integration (QA-M4-5)", () => {
  it("drives intro → judge → resolve through room timeouts with live snapshots", () => {
    const env = setupFinaleRoom();
    const { room, clock, a } = env;
    driveToFinale(env);
    expect(room.getPhase()).toBe("finaleIntro");
    clock.advance(FINALE_TIMERS.introMs);
    expect(room.handleTimeout()).toBe(true); // intro → judge turn 1
    expect(room.getPhase()).toBe("finaleTurn");
    // reconnect-style snapshot: the living runner's private view has options
    const priv = room.privateView(a, "player").phaseData as { finale: FinalePrivate | null };
    expect(priv.finale?.racing).toBe(true);
    expect(priv.finale?.options?.length).toBeGreaterThan(0);
    clock.advance(FINALE_TIMERS.turnMs);
    expect(room.handleTimeout()).toBe(true); // judge → resolve
    clock.advance(FINALE_TIMERS.resolveMs);
    expect(room.handleTimeout()).toBe(true); // resolve → next judge
    expect(room.getPhase()).toBe("finaleTurn");
  });

  it("pause mid-finale freezes the public deadline and resumes cleanly", () => {
    const env = setupFinaleRoom();
    const { room, clock } = env;
    driveToFinale(env);
    clock.advance(FINALE_TIMERS.introMs);
    room.handleTimeout(); // → judge
    room.applyAction(null, { action: "pause" });
    expect(room.publicState().deadline).toBeNull();
    clock.advance(120_000);
    expect(room.handleTimeout()).toBe(false); // frozen
    room.applyAction(null, { action: "resume" });
    expect(room.publicState().deadline).not.toBeNull();
    clock.advance(FINALE_TIMERS.turnMs);
    expect(room.handleTimeout()).toBe(true); // …still advances after resume
  });

  it("disconnected runners forfeit the judge turn (no 12s dead air, QA-M4-4)", () => {
    const env = setupFinaleRoom();
    const { room, clock, a, b } = env;
    driveToFinale(env);
    clock.advance(FINALE_TIMERS.introMs);
    room.handleTimeout(); // → judge (a living, b racing as a ghost)
    room.markDisconnected(b); // the ghost drops → empty judgment locked
    let pd = room.publicState().phaseData as { kind: string; sub?: string };
    expect(pd.sub).toBe("judge"); // a is still connected and judging
    room.markDisconnected(a); // the living runner drops too → all locked
    pd = room.publicState().phaseData as { kind: string; sub?: string };
    expect(pd.kind).toBe("finaleTurn");
    expect(pd.sub).toBe("resolve"); // resolved early, no 12s of dead air
  });
});

// ---------------------------------------------------------------------------
// Moderation portal (M7, §4.2): gated connect, kick, and moderator censor.
// ---------------------------------------------------------------------------
describe("Room × moderation portal (M7)", () => {
  it("moderator connect requires the GENERATED moderation password — always (QA-M7-1)", () => {
    const { room } = setup();
    expect(room.connectModerator("").ok).toBe(false); // moderation OFF
    room.applyAction(null, { action: "updateSettings", settings: { moderation: true } });
    const modPw = room.getModPassword();
    expect(modPw).not.toBeNull(); // §4.4: minted when the toggle flips on
    expect(room.connectModerator("").ok).toBe(false); // room members can't self-promote
    expect(room.connectModerator("wrong").ok).toBe(false);
    expect(room.connectModerator(modPw!).ok).toBe(true);
    // shown ONLY on the host view, never to players
    expect(room.privateView(null, "host").modPassword).toBe(modPw);
    const { room: r2, a } = setup();
    r2.applyAction(null, { action: "updateSettings", settings: { moderation: true } });
    expect(r2.privateView(a, "player").modPassword).toBeUndefined();
  });

  it("kick fully removes the seat: untimed rounds resolve and the kamra never sentences the absentee (QA-M7-2)", () => {
    let t = 3_000_000;
    const clock = { now: () => t, advance: (d: number) => (t += d) };
    const room = new Room(
      "KICK",
      () => new KhooniSawaalEngine(bank(), { pickQuestions: (b, count) => b.slice(0, count), rand: () => 0 }),
      clock.now,
    );
    const a = room.join({ name: "Amma" });
    const b = room.join({ name: "Babu" });
    const c = room.join({ name: "Chhotu" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("joins failed");
    room.applyAction(null, { action: "updateSettings", settings: { timerMode: "off" } });
    room.applyAction(a.playerId!, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout(); // → q1, UNTIMED (deadline null)
    room.applyAction(a.playerId!, answerAction("q_0001", 0));
    room.applyAction(b.playerId!, answerAction("q_0001", 0));
    // c never answers; without removal this room would hang forever
    expect(room.applyAction(null, { action: "kick", playerId: c.playerId! }, "moderator")).toBeNull();
    expect(room.getPhase()).toBe("reveal"); // round resolved by the remaining players
    const pd = room.publicState().phaseData as { kind: string; floor?: string[] };
    expect(pd.kind).toBe("reveal");
    expect(pd.floor).toEqual([]); // the kicked player is NOT sentenced (all remaining correct)
    expect(room.publicState().players.map((p) => p.name)).toEqual(["Amma", "Babu"]);
  });

  it("kick removes a player, forfeits their pending input, and queues the socket close", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout(); // → q1
    room.applyAction(a, answerAction("q_0001", 0));
    room.applyAction(b, answerAction("q_0001", 0));
    // c never answers; the moderator kicks them → forfeit resolves the round
    expect(room.applyAction(null, { action: "kick", playerId: c }, "moderator")).toBeNull();
    expect(room.getPhase()).toBe("reveal"); // c's forfeit completed the question
    expect(room.publicState().players.some((p) => p.id === c)).toBe(false);
    expect(room.takeKicked()).toEqual([c]);
  });

  it("kick never drops the room below the in-game minimum", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout();
    expect(room.applyAction(null, { action: "kick", playerId: b }, "moderator")).toBeNull();
    expect(room.applyAction(null, { action: "kick", playerId: c }, "moderator")).toBeNull();
    // only a remains — kicking the last player mid-game is refused
    expect(room.applyAction(null, { action: "kick", playerId: a }, "moderator")).toBe("NOT_ALLOWED");
  });

  it("players cannot kick; moderators cannot pause", () => {
    const { room, a, b } = setup();
    expect(room.applyAction(a, { action: "kick", playerId: b }, "player")).toBe("NOT_ALLOWED");
    expect(room.applyAction(null, { action: "pause" }, "moderator")).toBe("NOT_ALLOWED");
  });

  it("moderator censor rides the engine path without erroring on non-voting games", () => {
    const { room, clock, a, b, c } = setup();
    room.applyAction(a, { action: "startGame" });
    clock.advance(TIMERS.tutorialMs);
    room.handleTimeout(); // q1
    room.applyAction(a, answerAction("q_0001", 1));
    room.applyAction(b, answerAction("q_0001", 2));
    room.applyAction(c, answerAction("q_0001", 0));
    clock.advance(TIMERS.revealMs);
    room.handleTimeout(); // → kamra intro (rand 0 → hisaabKitaab, non-voting)
    clock.advance(KAMRA_TIMERS.introMs);
    room.handleTimeout(); // → play
    expect(room.applyAction(null, { action: "modCensor", targetId: a }, "moderator")).toBeNull();
  });
});
