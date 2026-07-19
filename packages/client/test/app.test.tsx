import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "../src/App.js";

describe("App shell", () => {
  it("renders the join placeholder with platform branding", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Tamasha");
    expect(html).toContain("Join");
  });
});
