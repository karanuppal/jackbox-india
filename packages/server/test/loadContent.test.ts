import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFinaleBank, loadKamraContent, loadQuestionBank } from "../src/content/load.js";

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

describe("loadKamraContent / loadFinaleBank (M3)", () => {
  it("loads and validates the shipped kamra pools", () => {
    const c = loadKamraContent();
    expect(c.spellingWords.length).toBeGreaterThan(0);
    expect(c.worstPrompts.length).toBeGreaterThan(0);
    expect(c.drawPrompts.length).toBeGreaterThan(0);
    expect(c.spellingWords[0]!.word).toMatch(/^[a-z]+$/);
  });

  it("loads and validates the shipped finale categories", () => {
    const f = loadFinaleBank();
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]!.options.length).toBeGreaterThanOrEqual(6);
  });

  it("throws on a schema-invalid spelling pool", () => {
    const d = dirWith("spelling.json", JSON.stringify([{ id: "sw_0001", word: "NOPE UPPER", vo: "sw_0001.ogg", adult: false }]));
    writeFileToDir(d, "prompts-worst.json", "[]");
    writeFileToDir(d, "prompts-drawing.json", "[]");
    expect(() => loadKamraContent(d)).toThrow();
  });
});

function writeFileToDir(dir: string, name: string, contents: string): void {
  writeFileSync(join(dir, name), contents);
}
