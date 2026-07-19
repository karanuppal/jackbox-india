import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BRANDING } from "@tamasha/shared";
import { App, resolveRoute, type Env } from "../src/App.js";

const env = (pathname: string): Env => ({
  pathname,
  origin: "http://localhost:5173",
  wsUrl: "ws://localhost:5173/play",
  search: "",
});

describe("resolveRoute (UT-M0-1/2/3)", () => {
  it("matches exact routes", () => {
    expect(resolveRoute("/")).toBe("join");
    expect(resolveRoute("/host")).toBe("host");
    expect(resolveRoute("/mod")).toBe("mod");
  });

  it("is case-insensitive and tolerates trailing slashes", () => {
    expect(resolveRoute("/HOST")).toBe("host");
    expect(resolveRoute("/Host/")).toBe("host");
    expect(resolveRoute("/MOD")).toBe("mod");
    expect(resolveRoute("//")).toBe("join");
  });

  it("does NOT prefix-match", () => {
    expect(resolveRoute("/hostile")).toBe("notFound");
    expect(resolveRoute("/hosting")).toBe("notFound");
    expect(resolveRoute("/model")).toBe("notFound");
    expect(resolveRoute("/does-not-exist")).toBe("notFound");
  });
});

describe("App shell", () => {
  it("renders the join form with platform branding", () => {
    const html = renderToString(<App env={env("/")} />);
    expect(html).toContain(BRANDING.platformName);
    expect(html).toContain("Room code");
  });

  it("renders the moderator placeholder", () => {
    const html = renderToString(<App env={env("/mod")} />);
    expect(html).toContain("Moderator");
  });

  it("renders an in-voice unknown-route screen with a way home", () => {
    const html = renderToString(<App env={env("/hostile")} />);
    expect(html).toContain(BRANDING.venueName);
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Host Screen");
  });

  it("contains no developer debris in user-visible copy (UT-M0-4)", () => {
    for (const p of ["/", "/mod", "/nope"]) {
      const html = renderToString(<App env={env(p)} />);
      expect(html).not.toMatch(/scaffold|\bM0\b|milestone/i);
    }
  });
});
