// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { KsPublicPhase, PlayerPublic, RoomPublicState } from "@tamasha/shared";
import { Controller } from "../src/screens/Controller.js";
import { Host } from "../src/screens/Host.js";
import { initialState, type ClientState } from "../src/net/store.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const player = (over: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id: "p1", name: "Karan", avatar: 0, vip: true, alive: true, money: 0, connected: true, answered: false, ...over,
});
const base = (phase: RoomPublicState["phase"], phaseData: KsPublicPhase | null, over: Partial<RoomPublicState> = {}): RoomPublicState => ({
  code: "ACDE", phase, paused: false,
  settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, passwordRequired: false, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
  players: [player()], audienceCount: 0, questionNumber: 0, questionTotal: 0, deadline: null, phaseData, ...over,
});
const joined = (over: Partial<ClientState>): ClientState => ({ ...initialState(), status: "joined", ...over });

const question: KsPublicPhase = {
  kind: "question", questionId: "q_0001", text: "Sholay mein kya hua?",
  options: ["ek", "do", "teen", "chaar"], number: 3, total: 10, vo: "Dhyaan se…",
};
const reveal: KsPublicPhase = {
  kind: "reveal", questionId: "q_0001", text: "Sholay mein kya hua?", options: ["ek", "do", "teen", "chaar"],
  correct: 0, tally: [{ index: 0, count: 2, correct: true }, { index: 1, count: 0, correct: false }, { index: 2, count: 1, correct: false }, { index: 3, count: 0, correct: false }],
  deaths: ["p2"], mercy: false, allCorrect: false, vo: "Kuch mehmaan…",
};
const gameOver: KsPublicPhase = {
  kind: "gameOver",
  standings: [{ playerId: "p1", name: "Karan", money: 5000, alive: true }, { playerId: "p2", name: "Priya", money: 2000, alive: false }],
  winnerId: "p1", vo: "Bas, itna hi.",
};

let root: Root; let container: HTMLElement;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("Controller — trivia phases", () => {
  it("renders four option buttons during a question and dispatches an answer", async () => {
    const actions: unknown[] = [];
    const state = joined({ public: base("question", question), private: { you: player(), role: "player", phaseData: { myAnswer: null, answered: false, alive: true } } });
    await act(async () => { root.render(<Controller state={state} onAction={(p) => actions.push(p)} />); });
    const buttons = [...container.querySelectorAll("button")].filter((b) => ["ek", "do", "teen", "chaar"].includes(b.textContent ?? ""));
    expect(buttons).toHaveLength(4);
    await act(async () => { buttons[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(actions).toContainEqual({ action: "game", payload: { type: "answer", questionId: "q_0001", optionIndex: 2 } });
  });

  it("shows a locked-in wait card after answering", () => {
    const state = joined({ public: base("question", question), private: { you: player({ answered: true }), role: "player", phaseData: { myAnswer: 1, answered: true, alive: true } } });
    const html = renderToString(<Controller state={state} onAction={() => {}} />);
    expect(html).toContain("lock ho gaya");
  });

  it("frames a ghost player as aatma mode", () => {
    const state = joined({ public: base("question", question), private: { you: player({ alive: false }), role: "player", phaseData: { myAnswer: null, answered: false, alive: false } } });
    const html = renderToString(<Controller state={state} onAction={() => {}} />);
    expect(html).toContain("Aatma mode");
  });

  it("shows mercy text on a mercy reveal", () => {
    const mercyReveal: KsPublicPhase = { ...reveal, mercy: true, deaths: [] };
    const state = joined({ public: base("reveal", mercyReveal), private: { you: player(), role: "player", phaseData: { myAnswer: 1, answered: true, alive: true } } });
    const html = renderToString(<Controller state={state} onAction={() => {}} />);
    expect(html).toContain("Sab bach gaye");
  });
});

describe("Host — game scenes", () => {
  it("renders the question scene with progress and options", () => {
    const html = renderToString(<Host state={joined({ public: base("question", question) })} origin="http://localhost" />);
    expect(html).toContain("Sholay mein kya hua?");
    expect(html).toContain("Sawaal 3 / 10");
    expect(html).toContain("Dhyaan se"); // subtitle
  });

  it("renders the reveal with the correct answer highlighted and a death count", () => {
    const html = renderToString(<Host state={joined({ public: base("reveal", reveal) })} origin="http://localhost" />);
    expect(html).toContain("Khooni Kamra ki taraf");
  });

  it("renders the game-over standings with the winner crowned", () => {
    const html = renderToString(<Host state={joined({ public: base("gameOver", gameOver) })} origin="http://localhost" />);
    expect(html).toContain("Natija");
    expect(html).toContain("Karan");
    expect(html).toContain("₹5000");
    expect(html).toContain("👑");
    expect(html).toContain("👻"); // dead player marked
  });

  it("hides subtitles when the setting is off", () => {
    const state = joined({ public: base("question", question, { settings: { ...base("question", question).settings, subtitles: false } }) });
    const html = renderToString(<Host state={state} origin="http://localhost" />);
    expect(html).not.toContain("Dhyaan se");
  });
});
