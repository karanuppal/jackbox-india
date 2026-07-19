import { describe, expect, it } from "vitest";
import { joinUrl, qrSvg } from "../src/net/qr.js";

describe("qr", () => {
  it("builds a join URL with the code query", () => {
    expect(joinUrl("http://localhost:5173", "ACDE")).toBe("http://localhost:5173/?code=ACDE");
    expect(joinUrl("http://x/", "FHJK")).toBe("http://x/?code=FHJK");
  });

  it("renders an SVG QR for a join URL", async () => {
    const svg = await qrSvg(joinUrl("http://localhost", "ACDE"));
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
