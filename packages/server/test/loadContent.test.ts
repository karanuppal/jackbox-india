import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadQuestionBank } from "../src/content/load.js";

function dirWith(name: string, contents: string): string {
  const d = mkdtempSync(join(tmpdir(), "tamasha-content-"));
  writeFileSync(join(d, name), contents);
  return d + "/";
}

describe("loadQuestionBank (QA-M2-8)", () => {
  it("loads and validates the real shipped bank", () => {
    const bank = loadQuestionBank(); // default path → /content
    expect(bank.length).toBeGreaterThan(0);
    expect(bank[0]!.id).toMatch(/^q_\d{4}$/);
  });

  it("throws on malformed JSON", () => {
    const d = dirWith("questions.json", "{ not json");
    expect(() => loadQuestionBank(d)).toThrow();
  });

  it("throws on a schema-invalid bank", () => {
    const d = dirWith("questions.json", JSON.stringify([{ id: "bad" }]));
    expect(() => loadQuestionBank(d)).toThrow();
  });

  it("throws on an empty bank (min-1 guard)", () => {
    const d = dirWith("questions.json", "[]");
    expect(() => loadQuestionBank(d)).toThrow();
  });
});
