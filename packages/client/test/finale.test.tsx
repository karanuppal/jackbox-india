// @vitest-environment jsdom
// M4 client coverage: Aakhri Darwaza host track + controller judge panel (§3.6).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { FinalePrivate, FinalePublic } from "@tamasha/shared";
import { ControllerFinale, HostFinaleScene } from "../src/screens/finale.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runners = [
  { id: "L", name: "Karan", kind: "living" as const, distance: 14, eliminated: false, lastMove: 0, locked: false },
  { id: "g1", name: "Bunty", kind: "ghost" as const, distance: 18, eliminated: false, lastMove: 2, locked: true },
  { id: "audience", name: "Audience", kind: "audience" as const, distance: 21, eliminated: false, lastMove: 0, locked: false },
];

const intro: FinalePublic = { kind: "finaleIntro", runners, vo: "Bhaago!" };
const judge: FinalePublic = {
  kind: "finaleTurn", sub: "judge", turn: 2, categoryTitle: "SRK double roles",
  runners, darkness: 26, events: [], vo: "Chuno.",
};
const resolve: FinalePublic = {
  kind: "finaleTurn", sub: "resolve", turn: 2, categoryTitle: "SRK double roles",
  runners,
  darkness: 22,
  events: [
    { type: "steal", byId: "g1", fromId: "L" },
    { type: "darkness", id: "audience" },
    { type: "barrier", id: "g1" },
    { type: "escape", id: "L" },
  ],
  vo: "Dekho.",
};
const priv: FinalePrivate = {
  racing: true,
  options: [{ index: 0, text: "Duplicate" }, { index: 3, text: "Ra.One" }],
  selection: null,
  locked: false,
};

let root: Root; let container: HTMLElement;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const click = (el: Element) => { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };

describe("HostFinaleScene", () => {
  it("renders the intro with the track, door, and every runner", () => {
    const html = renderToString(<HostFinaleScene pub={intro} deadline={null} subtitles />);
    expect(html).toContain("AAKHRI DARWAZA");
    expect(html).toContain("🚪");
    expect(html).toContain("Karan");
    expect(html).toContain("Bunty");
    expect(html).toContain("Audience");
  });

  it("renders a judge turn with the category, darkness, and locked diyas", () => {
    const html = renderToString(<HostFinaleScene pub={judge} deadline={null} subtitles />);
    expect(html).toContain("SRK double roles");
    expect(html).toContain("chakkar 2");
    expect(html).toContain("🪔 Bunty"); // locked marker
  });

  it("renders resolve events: steal, darkness, barrier, escape", () => {
    const html = renderToString(<HostFinaleScene pub={resolve} deadline={null} subtitles />);
    expect(html).toContain("shareer chheen liya");
    expect(html).toContain("nigal liya");
    expect(html).toContain("atak gaya");
    expect(html).toContain("nikal gaya");
  });
});

describe("ControllerFinale", () => {
  it("intro tells the living, ghosts, and audience their role", () => {
    let html = renderToString(<ControllerFinale pub={intro} priv={null} youId="L" isAudience={false} deadline={null} onAction={() => {}} />);
    expect(html).toContain("ZINDA");
    html = renderToString(<ControllerFinale pub={intro} priv={null} youId="g1" isAudience={false} deadline={null} onAction={() => {}} />);
    expect(html).toContain("aatma");
    html = renderToString(<ControllerFinale pub={intro} priv={null} youId={null} isAudience deadline={null} onAction={() => {}} />);
    expect(html).toContain("Audience ek saath");
  });

  it("judge panel: toggling options and locking dispatches fjJudge with the selection", async () => {
    const actions: unknown[] = [];
    await act(async () => {
      root.render(<ControllerFinale pub={judge} priv={priv} youId="L" isAudience={false} deadline={null} onAction={(p) => actions.push(p)} />);
    });
    const dup = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Duplicate"))!;
    click(dup); // select
    const ra = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Ra.One"))!;
    click(ra); click(ra); // select then unselect
    click([...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Lock karo"))!);
    expect(actions).toContainEqual({ action: "game", payload: { type: "fjJudge", turn: 2, selection: [0] } });
    expect(container.textContent).toContain("Lock ho gaya");
  });

  it("non-racers see the watch card during a judge turn", () => {
    const html = renderToString(<ControllerFinale pub={judge} priv={{ racing: false, options: null, selection: null, locked: false }} youId="dead" isAudience={false} deadline={null} onAction={() => {}} />);
    expect(html).toContain("screen dekho");
  });

  it("resolve tells each runner their own fate", () => {
    let html = renderToString(<ControllerFinale pub={resolve} priv={null} youId="L" isAudience={false} deadline={null} onAction={() => {}} />);
    // L both escaped and was stolen-from in the fixture; escape wins the message
    expect(html).toContain("NIKAL GAYE");
    const stolenOnly: FinalePublic = { ...resolve, events: [{ type: "steal", byId: "g1", fromId: "L" }] };
    html = renderToString(<ControllerFinale pub={stolenOnly} priv={null} youId="L" isAudience={false} deadline={null} onAction={() => {}} />);
    expect(html).toContain("chhin gaya");
    html = renderToString(<ControllerFinale pub={stolenOnly} priv={null} youId="g1" isAudience={false} deadline={null} onAction={() => {}} />);
    expect(html).toContain("Shareer aapka");
  });
});
