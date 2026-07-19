// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App.js";
import { RoomConnection } from "../src/net/connection.js";
import { reduce, initialState } from "../src/net/store.js";
import { clearSession, loadSession, saveSession } from "../src/net/session.js";
import { Host } from "../src/screens/Host.js";
import { initialState as freshState } from "../src/net/store.js";
import type { RoomPublicState } from "@tamasha/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("App with no env prop (browserEnv)", () => {
  it("derives env from window.location in the browser", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => {
      root.render(<App />); // no env → browserEnv() reads jsdom window
    });
    // jsdom default path is "/" → join form
    expect(div.textContent).toContain("Room code");
    act(() => root.unmount());
    div.remove();
  });
});

describe("RoomConnection guards", () => {
  it("ping and sendAction before connect are no-ops (null ws)", () => {
    const conn = new RoomConnection({ wsUrl: "ws://x", join: { code: "ACDE", intent: "play", name: "X" }, onState: () => {} });
    expect(() => conn.ping()).not.toThrow();
    expect(() => conn.sendAction({ action: "pause" })).not.toThrow();
  });
});

describe("store — socketOpen while reconnecting", () => {
  it("keeps reconnecting status on a socketOpen mid-reconnect", () => {
    let s = reduce(initialState(), { kind: "reconnecting" });
    s = reduce(s, { kind: "socketOpen" });
    expect(s.status).toBe("reconnecting");
  });
});

describe("session — real localStorage path", () => {
  it("round-trips through the default (jsdom) storage", () => {
    clearSession("WXYZ");
    expect(loadSession("WXYZ")).toBeNull();
    saveSession({ code: "WXYZ", name: "Karan", sessionToken: "t1" });
    expect(loadSession("WXYZ")?.sessionToken).toBe("t1");
    clearSession("WXYZ");
    expect(loadSession("WXYZ")).toBeNull();
  });
});

describe("Host — settings chips", () => {
  it("shows chips for non-default settings", () => {
    const pub: RoomPublicState = {
      code: "ACDE", phase: "lobby", paused: false,
      settings: { familyFriendly: false, profanityFilter: "off", moderation: false, subtitles: true, timerMode: "extended", reducedMotion: false, audienceEnabled: false, passwordRequired: true, hideRoomCode: false, controllerOnlyStart: false, skipTutorial: false },
      players: [], audienceCount: 0, questionNumber: 0, questionTotal: 0, deadline: null, phaseData: null,
    };
    const html = renderToString(<Host state={{ ...freshState(), status: "joined", public: pub }} origin="http://localhost" />);
    expect(html).toContain("Full masala");
    expect(html).toContain("Audience off");
    expect(html).toContain("Password lagega");
    expect(html).toContain("Timers: extended");
  });
});
