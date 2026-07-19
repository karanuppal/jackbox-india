// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BRANDING } from "@tamasha/shared";
import { App, type Env } from "../src/App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const env = (pathname: string): Env => ({
  pathname,
  origin: "http://localhost",
  wsUrl: "ws://localhost/play",
  search: "",
});

describe("document titles per route (UT-M0-6)", () => {
  async function mount(pathname: string): Promise<void> {
    const div = document.createElement("div");
    document.body.appendChild(div);
    await act(async () => {
      createRoot(div).render(<App env={env(pathname)} />);
    });
  }

  it("distinguishes host screen from join in the tab title", async () => {
    await mount("/host");
    expect(document.title).toContain("Host Screen");
    expect(document.title).toContain(BRANDING.gameName);
    await mount("/");
    expect(document.title).toContain("Join");
    expect(document.title).toContain(BRANDING.platformName);
    await mount("/mod");
    expect(document.title).toContain("Moderator");
  });
});
