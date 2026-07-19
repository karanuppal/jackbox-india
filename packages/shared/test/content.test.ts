import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkBankInvariants,
  finaleBankSchema,
  promptBankSchema,
  questionBankSchema,
  spellingBankSchema,
} from "../src/content.js";

const contentDir = fileURLToPath(new URL("../../../content/", import.meta.url));
const load = (name: string) =>
  JSON.parse(readFileSync(contentDir + name, "utf8"));

describe("content banks", () => {
  it("questions.json matches the schema", () => {
    const bank = questionBankSchema.parse(load("questions.json"));
    expect(bank.length).toBeGreaterThan(0);
  });

  it("questions.json passes cross-item invariants", () => {
    const bank = questionBankSchema.parse(load("questions.json"));
    expect(checkBankInvariants(bank)).toEqual([]);
  });

  it("finale.json matches the schema and every category has 2-5 true fits", () => {
    const bank = finaleBankSchema.parse(load("finale.json"));
    for (const cat of bank) {
      const fits = cat.options.filter((o) => o.fits).length;
      expect(fits, cat.id).toBeGreaterThanOrEqual(2);
      expect(fits, cat.id).toBeLessThanOrEqual(5);
    }
  });

  it("prompt banks match the schema with correct id prefixes", () => {
    const worst = promptBankSchema.parse(load("prompts-worst.json"));
    const drawing = promptBankSchema.parse(load("prompts-drawing.json"));
    expect(worst.every((p) => p.id.startsWith("pw_"))).toBe(true);
    expect(drawing.every((p) => p.id.startsWith("pd_"))).toBe(true);
  });

  it("spelling.json matches the schema", () => {
    const bank = spellingBankSchema.parse(load("spelling.json"));
    for (const w of bank) {
      expect(w.word.length).toBeGreaterThanOrEqual(5);
      expect(w.word.length).toBeLessThanOrEqual(8);
    }
  });

  it("content policy: no banned-topic keywords appear in any content text", () => {
    // Coarse tripwire for PLAN.md §6.4 — the human policy pass is the real
    // gate; this catches obvious drift in CI.
    const banned =
      /\b(bjp|congress|modi|rahul gandhi|election|mandir|masjid|temple|church|allah|bhagwan|jesus|kashmir|pakistan army|caste|dalit|brahmin|hindu|muslim|sikh|christian)\b/i;
    const texts: string[] = [];
    for (const q of questionBankSchema.parse(load("questions.json"))) {
      texts.push(q.text, ...q.options);
    }
    for (const c of finaleBankSchema.parse(load("finale.json"))) {
      texts.push(c.title, ...c.options.map((o) => o.text));
    }
    for (const p of promptBankSchema.parse(load("prompts-worst.json"))) texts.push(p.text);
    for (const p of promptBankSchema.parse(load("prompts-drawing.json"))) texts.push(p.text);
    const offenders = texts.filter((t) => banned.test(t));
    expect(offenders).toEqual([]);
  });
});
