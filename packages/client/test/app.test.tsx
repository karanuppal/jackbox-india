import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BRANDING } from "@tamasha/shared";
import { App, resolveRoute } from "../src/App.js";

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
  it("renders the join page with platform branding from the shared config", () => {
    const html = renderToString(<App path="/" />);
    expect(html).toContain(BRANDING.platformName);
    expect(html).toContain("Join");
  });

  it("renders the host screen with the game name", () => {
    const html = renderToString(<App path="/host" />);
    expect(html).toContain(BRANDING.gameName);
    expect(html).toContain("Host Screen");
  });

  it("renders the moderator portal", () => {
    const html = renderToString(<App path="/mod" />);
    expect(html).toContain("Moderator");
  });

  it("renders an in-voice unknown-route screen with a way home", () => {
    const html = renderToString(<App path="/hostile" />);
    expect(html).toContain("Manzil Mahal");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("Host Screen");
  });

  it("contains no developer debris in user-visible copy (UT-M0-4)", () => {
    for (const path of ["/", "/host", "/mod", "/nope"]) {
      const html = renderToString(<App path={path} />);
      expect(html).not.toMatch(/scaffold|M0|milestone/i);
    }
  });
});
