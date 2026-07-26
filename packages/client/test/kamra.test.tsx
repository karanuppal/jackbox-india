// @vitest-environment jsdom
// M3 client coverage: killing-floor host scenes + all 8 controller minigame
// widgets, voting, VIP censor, drawing canvas, and the wheel (§3.4/§5.3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type {
  KamraPublicPhase,
  KamraPrivate,
  KsPublicPhase,
  MinigameKind,
  PlayerPublic,
  RoomPublicState,
  WheelPublic,
} from "@tamasha/shared";
import { Controller } from "../src/screens/Controller.js";
import { Host } from "../src/screens/Host.js";
import { DrawingCanvas, HostKamraScene, StrokesView, scramble } from "../src/screens/kamra.js";
import { initialState, type ClientState } from "../src/net/store.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const player = (over: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id: "p1", name: "Karan", avatar: 0, vip: false, alive: true, money: 0, connected: true, answered: false, ...over,
});
const base = (phase: RoomPublicState["phase"], phaseData: KsPublicPhase | null, over: Partial<RoomPublicState> = {}): RoomPublicState => ({
  code: "ACDE", phase, paused: false,
  settings: { familyFriendly: true, profanityFilter: "strict", moderation: false, subtitles: true, timerMode: "normal", reducedMotion: false, audienceEnabled: true, passwordRequired: false, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
  players: [player()], audienceCount: 0, questionNumber: 1, questionTotal: 10, deadline: null, phaseData, ...over,
});
const joined = (over: Partial<ClientState>): ClientState => ({ ...initialState(), status: "joined", ...over });
const privOnFloor = (data: unknown, done = false): { myAnswer: null; answered: boolean; alive: boolean; kamra: KamraPrivate } => ({
  myAnswer: null, answered: done, alive: true, kamra: { onFloor: true, data, done },
});

const floor = [{ playerId: "p1", name: "Karan", score: 0, done: false }, { playerId: "p2", name: "Bunty", score: 0, done: true }];

function play(minigame: MinigameKind, prompt: string | null = null): Extract<KamraPublicPhase, { kind: "kamraPlay" }> {
  return { kind: "kamraPlay", minigame, floor, prompt, vo: "Khelo…" };
}

let root: Root; let container: HTMLElement;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const buttons = () => [...container.querySelectorAll("button")];
const find = (label: string) => buttons().find((b) => b.textContent?.includes(label))!;

async function renderController(pub: KamraPublicPhase | WheelPublic, priv: unknown, actions: unknown[], over: Partial<ClientState> = {}) {
  const state = joined({
    public: base("khooniKamra", pub as KsPublicPhase),
    private: { you: player(), role: "player", phaseData: priv },
    ...over,
  });
  await act(async () => { root.render(<Controller state={state} onAction={(p) => actions.push(p)} />); });
}

describe("Host — kamra scenes", () => {
  it("renders the intro with title, rules and the floor roster", () => {
    const pub: KamraPublicPhase = { kind: "kamraIntro", minigame: "hisaabKitaab", title: "Hisaab-Kitaab", rules: "Jaldi jodo.", floor, vo: "Thoda hisaab…" };
    const html = renderToString(<Host state={joined({ public: base("khooniKamra", pub) })} origin="http://x" />);
    expect(html).toContain("KHOONI KAMRA");
    expect(html).toContain("Hisaab-Kitaab");
    expect(html).toContain("Karan");
    expect(html).toContain("Bunty");
  });

  it("renders play with the shared prompt and per-player lock state", () => {
    const html = renderToString(<Host state={joined({ public: base("khooniKamra", play("spellingShelling", "khichdi")) })} origin="http://x" />);
    expect(html).toContain("khichdi");
    expect(html).toContain("lock ho gaya"); // Bunty done
    expect(html).toContain("khel raha hai"); // Karan not done
  });

  it("renders vote entries — text answers and drawings — with vote counts", () => {
    const pub: KamraPublicPhase = {
      kind: "kamraVote", minigame: "gandaChitra",
      entries: [
        { playerId: "p1", name: "Karan", text: null, strokes: [{ color: 1, width: 3, points: [[0.1, 0.1], [0.5, 0.5]] }], votesAgainst: 2 },
        { playerId: "p2", name: "Bunty", text: "chai", strokes: null, votesAgainst: 0 },
      ],
      vo: "Vote karo.",
    };
    const html = renderToString(<Host state={joined({ public: base("khooniKamra", pub) })} origin="http://x" />);
    expect(html).toContain("Sabse ghatiya");
    expect(html).toContain("polyline"); // drawing rendered as SVG
    expect(html).toContain("chai");
    expect(html).toContain("2 👎");
  });

  it("renders the result with deaths and survivors named", () => {
    const pub: KamraPublicPhase = { kind: "kamraResult", minigame: "zeharWaliChai", deaths: ["p2"], survivors: ["p1"], vo: "Faisla." };
    const players = [player(), player({ id: "p2", name: "Bunty" })];
    const html = renderToString(<Host state={joined({ public: base("khooniKamra", pub, { players }) })} origin="http://x" />);
    expect(html).toContain("💀");
    expect(html).toContain("Bunty");
    expect(html).toContain("bach gaye: Karan");
  });

  it("renders a no-deaths result as everyone surviving", () => {
    const pub: KamraPublicPhase = { kind: "kamraResult", minigame: "dhokha", deaths: [], survivors: ["p1", "p2"], vo: "Wafaadaari." };
    const html = renderToString(<HostKamraScene pub={pub} players={[player()]} deadline={null} subtitles />);
    expect(html === "" ? renderToString(<HostKamraScene pub={pub} players={[player()]} deadline={null} subtitles />) : html).toContain("Sab bach gaye");
  });

  it("renders the wheel with spinner name, spinning state, then the outcome", () => {
    const spinning: WheelPublic = { kind: "wheel", spinnerId: "p1", spinnerName: "Karan", outcome: null, vo: "Ghoomta hai…" };
    let html = renderToString(<Host state={joined({ public: base("wheel", spinning) })} origin="http://x" />);
    expect(html).toContain("MAUT KA CHAKRA");
    expect(html).toContain("Karan");
    expect(html).toContain("🎡");
    const landed: WheelPublic = { ...spinning, outcome: "death" };
    html = renderToString(<Host state={joined({ public: base("wheel", landed) })} origin="http://x" />);
    expect(html).toContain("💀");
    expect(html).toContain("Maut.");
  });
});

describe("Controller — kamra minigames", () => {
  it("K1 math: keypad entry dispatches kmMath with the typed value", async () => {
    const actions: unknown[] = [];
    await renderController(play("hisaabKitaab"), privOnFloor({ a: 7, b: 4, op: "+" }), actions);
    expect(container.textContent).toContain("7 + 4");
    click(find("1")); click(find("2")); // types "12"
    click(find("Jawaab do"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmMath", value: 12 } });
  });

  it("K1 math: minus key allows negative answers", async () => {
    const actions: unknown[] = [];
    await renderController(play("hisaabKitaab"), privOnFloor({ a: 3, b: 9, op: "-" }), actions);
    click(find("-")); click(find("6"));
    click(find("Jawaab do"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmMath", value: -6 } });
  });

  it("K2 memory: shows the burning pattern, then lets tiles be picked and locked", async () => {
    vi.useFakeTimers();
    const actions: unknown[] = [];
    await renderController(play("yaaddasht"), privOnFloor({ size: 16, pattern: [0, 3, 5] }), actions);
    expect(container.textContent).toContain("YAAD KARO");
    await act(async () => { vi.advanceTimersByTime(6500); });
    expect(container.textContent).toContain("wahi tiles dabao");
    click(container.querySelector('[aria-label="tile 0"]')!);
    click(container.querySelector('[aria-label="tile 3"]')!);
    click(find("Lock karo"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmRecall", selection: [0, 3] } });
    vi.useRealTimers();
  });

  it("K3 taash: memorize cards then select positions of the target symbol", async () => {
    vi.useFakeTimers();
    const actions: unknown[] = [];
    await renderController(play("taashKePatte"), privOnFloor({ cards: [1, 0, 1], target: 1 }), actions);
    expect(container.textContent).toContain("Patte yaad karo");
    await act(async () => { vi.advanceTimersByTime(6500); });
    click(container.querySelector('[aria-label="card 0"]')!);
    click(container.querySelector('[aria-label="card 2"]')!);
    click(find("Lock karo"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmRecall", selection: [0, 2] } });
    vi.useRealTimers();
  });

  it("K4 spelling: scrambled keys build the word and dispatch kmSpell", async () => {
    const actions: unknown[] = [];
    await renderController(play("spellingShelling", "chai"), privOnFloor(null), actions);
    // tap the keys in the order that spells "chai"
    for (const ch of "chai") {
      const key = buttons().find((b) => b.textContent === ch && !b.disabled)!;
      await act(async () => { click(key); });
    }
    click(find("Lock karo"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmSpell", word: "chai" } });
  });

  it("scramble() never returns the solved word and keeps all letters", () => {
    for (const word of ["khichdi", "shaadi", "chai", "restaurant"]) {
      const s = scramble(word);
      expect(s.join("")).not.toBe(word);
      expect([...s].sort().join("")).toBe([...word].sort().join(""));
    }
  });

  it("K5 worst answer: text entry dispatches kmAnswer", async () => {
    const actions: unknown[] = [];
    await renderController(play("sabseGhatiyaJawaab", "Aunty ka message"), privOnFloor(null), actions);
    const ta = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, "ghatiya jawab");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(find("Bhejo"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmAnswer", text: "ghatiya jawab" } });
  });

  it("K7 chai: tapping a glass dispatches kmPick", async () => {
    const actions: unknown[] = [];
    await renderController(play("zeharWaliChai"), privOnFloor({ cups: 3, myPick: null }), actions);
    click(container.querySelector('[aria-label="chai 2"]')!);
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmPick", index: 2 } });
  });

  it("K8 dhokha: spare and betray both dispatch kmChoice", async () => {
    const actions: unknown[] = [];
    await renderController(play("dhokha"), privOnFloor({ myChoice: null }), actions);
    click(find("SPARE"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmChoice", choice: "spare" } });
    click(find("SAVE MYSELF"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmChoice", choice: "betray" } });
  });

  it("locked-in floor player sees the dua card; off-floor players watch", async () => {
    await renderController(play("hisaabKitaab"), privOnFloor({ a: 1, b: 1, op: "+" }, true), []);
    expect(container.textContent).toContain("Lock ho gaya");
    await renderController(play("hisaabKitaab"), { myAnswer: null, answered: false, alive: true, kamra: { onFloor: false, data: null, done: false } }, []);
    expect(container.textContent).toContain("screen dekho");
  });

  it("intro: floor player is warned; result: the dead see aatma text", async () => {
    const intro: KamraPublicPhase = { kind: "kamraIntro", minigame: "dhokha", title: "Rishtedaari Test", rules: "…", floor, vo: "…" };
    await renderController(intro, privOnFloor(null), []);
    expect(container.textContent).toContain("Khooni Kamre mein ho");
    const result: KamraPublicPhase = { kind: "kamraResult", minigame: "dhokha", deaths: ["p1"], survivors: [], vo: "…" };
    await renderController(result, { myAnswer: null, answered: false, alive: false, kamra: null }, []);
    expect(container.textContent).toContain("aatma ban ke");
  });
});

describe("Controller — voting & censor", () => {
  const votePub: KamraPublicPhase = {
    kind: "kamraVote", minigame: "sabseGhatiyaJawaab",
    entries: [
      { playerId: "p2", name: "Bunty", text: "bakwaas", strokes: null, votesAgainst: 0 },
      { playerId: "p3", name: "Pinky", text: "theek hai", strokes: null, votesAgainst: 1 },
    ],
    vo: "Vote karo.",
  };
  const voterPriv = { myAnswer: null, answered: false, alive: true, kamra: { onFloor: false, data: null, done: false } };

  it("a living non-floor player can vote and the vote dispatches kmVote", async () => {
    const actions: unknown[] = [];
    await renderController(votePub, voterPriv, actions);
    click(find("Bunty"));
    expect(actions).toContainEqual({ action: "game", payload: { type: "kmVote", targetId: "p2" } });
  });

  it("the VIP sees censor buttons and censoring dispatches the censor action", async () => {
    const actions: unknown[] = [];
    const state = joined({
      public: base("khooniKamra", votePub),
      private: { you: player({ vip: true }), role: "player", phaseData: voterPriv },
    });
    await act(async () => { root.render(<Controller state={state} onAction={(p) => actions.push(p)} />); });
    click(container.querySelector('[aria-label="censor Bunty"]')!);
    expect(actions).toContainEqual({ action: "game", payload: { type: "censor", targetId: "p2" } });
  });

  it("a floor player cannot vote — they see the kismat card", async () => {
    await renderController(votePub, privOnFloor(null, true), []);
    expect(container.textContent).toContain("kismat");
  });

  it("a ghost (non-floor, dead) cannot vote", async () => {
    await renderController(votePub, { myAnswer: null, answered: false, alive: false, kamra: { onFloor: false, data: null, done: false } }, []);
    expect(container.textContent).toContain("Vote chal raha hai");
  });
});

describe("Controller — wheel", () => {
  it("tells the spinner it is their spin and others to watch", async () => {
    const wheel: WheelPublic = { kind: "wheel", spinnerId: "p1", spinnerName: "Karan", outcome: null, vo: "…" };
    await renderController(wheel, { myAnswer: null, answered: false, alive: true, kamra: null }, [], {});
    expect(container.textContent).toContain("Aapki baari");
    const other: WheelPublic = { ...wheel, spinnerId: "p9", spinnerName: "Pinky" };
    await renderController(other, { myAnswer: null, answered: false, alive: true, kamra: null }, [], {});
    expect(container.textContent).toContain("Screen dekho");
  });
});

describe("DrawingCanvas", () => {
  function drawOneStroke(actions: unknown[]) {
    const canvas = container.querySelector('[data-testid="canvas"]')!;
    const opts = { bubbles: true, clientX: 10, clientY: 10 };
    act(() => { canvas.dispatchEvent(new MouseEvent("pointerdown", opts)); });
    act(() => { canvas.dispatchEvent(new MouseEvent("pointermove", { ...opts, clientX: 30, clientY: 40 })); });
    act(() => { canvas.dispatchEvent(new MouseEvent("pointerup", opts)); });
    return actions.filter((a) => (a as { type?: string }).type === "drawStroke");
  }

  it("captures a pointer stroke and dispatches drawStroke with normalized points", async () => {
    const actions: unknown[] = [];
    await act(async () => { root.render(<DrawingCanvas prompt="Mumbai local" game={(p) => actions.push(p)} />); });
    const strokes = drawOneStroke(actions);
    expect(strokes).toHaveLength(1);
    const s = strokes[0] as { stroke: { color: number; points: [number, number][] } };
    expect(s.stroke.points.length).toBeGreaterThanOrEqual(1);
    for (const [x, y] of s.stroke.points) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("undo/clear/submit dispatch their draw actions", async () => {
    const actions: unknown[] = [];
    await act(async () => { root.render(<DrawingCanvas prompt="x" game={(p) => actions.push(p)} />); });
    click(find("Undo"));
    click(find("Saaf karo"));
    click(find("Ho gaya!"));
    expect(actions).toContainEqual({ type: "drawUndo" });
    expect(actions).toContainEqual({ type: "drawClear" });
    expect(actions).toContainEqual({ type: "drawSubmit" });
  });

  it("palette swatches switch the stroke color", async () => {
    const actions: unknown[] = [];
    await act(async () => { root.render(<DrawingCanvas prompt="x" game={(p) => actions.push(p)} />); });
    click(container.querySelector('[aria-label="rang 3"]')!);
    const strokes = drawOneStroke(actions);
    expect((strokes[0] as { stroke: { color: number } }).stroke.color).toBe(3);
  });

  it("StrokesView renders strokes as SVG polylines", () => {
    const html = renderToString(
      <StrokesView strokes={[{ color: 0, width: 3, points: [[0, 0], [1, 1]] }]} size="5rem" />,
    );
    expect(html).toContain("polyline");
    expect(html).toContain("0,0 100,100");
  });
});
