import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  checkBankInvariants,
  checkUniqueIds,
  finaleBankSchema,
  finaleCategorySchema,
  promptBankSchema,
  promptSchema,
  questionBankSchema,
  questionSchema,
  spellingBankSchema,
  spellingWordSchema,
  type Question,
} from "../src/content.js";

const contentDir = fileURLToPath(new URL("../../../content/", import.meta.url));
const load = (name: string) =>
  JSON.parse(readFileSync(contentDir + name, "utf8"));

const validQuestion = {
  id: "q_0001",
  text: "Yeh ek sample sawaal hai jo kaafi lamba hai?",
  textRoman: true,
  options: ["ek", "do", "teen", "chaar"],
  correct: 0,
  categories: ["food"],
  difficulty: 1,
  adult: false,
  vo: "q_0001.ogg",
  source: "sample fixture for tests",
  era: "evergreen",
};

describe("real content banks", () => {
  it("questions.json matches the schema", () => {
    const bank = questionBankSchema.parse(load("questions.json"));
    expect(bank.length).toBeGreaterThan(0);
  });

  it("questions.json passes cross-item invariants", () => {
    const bank = questionBankSchema.parse(load("questions.json"));
    expect(checkBankInvariants(bank)).toEqual([]);
  });

  it("finale.json matches the schema (2-5 fits enforced by schema)", () => {
    const bank = finaleBankSchema.parse(load("finale.json"));
    expect(checkUniqueIds(bank)).toEqual([]);
  });

  it("prompt banks match the schema with correct id prefixes", () => {
    const worst = promptBankSchema.parse(load("prompts-worst.json"));
    const drawing = promptBankSchema.parse(load("prompts-drawing.json"));
    expect(worst.every((p) => p.id.startsWith("pw_"))).toBe(true);
    expect(drawing.every((p) => p.id.startsWith("pd_"))).toBe(true);
    expect(checkUniqueIds([...worst, ...drawing])).toEqual([]);
  });

  it("spelling.json matches the schema (with VO per item)", () => {
    const bank = spellingBankSchema.parse(load("spelling.json"));
    expect(checkUniqueIds(bank)).toEqual([]);
    for (const w of bank) {
      expect(w.word.length).toBeGreaterThanOrEqual(5);
      expect(w.word.length).toBeLessThanOrEqual(8);
      expect(w.vo).toBe(`${w.id}.ogg`);
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

describe("schema rejection (QA-M0-11 — the validators must actually validate)", () => {
  it("rejects out-of-range correct index", () => {
    expect(questionSchema.safeParse({ ...validQuestion, correct: 4 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, correct: -1 }).success).toBe(false);
  });

  it("rejects wrong option counts", () => {
    expect(questionSchema.safeParse({ ...validQuestion, options: ["a", "b", "c"] }).success).toBe(false);
    expect(
      questionSchema.safeParse({ ...validQuestion, options: ["a", "b", "c", "d", "e"] }).success,
    ).toBe(false);
  });

  it("rejects missing/short source (fact-check mandate §6.5)", () => {
    expect(questionSchema.safeParse({ ...validQuestion, source: "" }).success).toBe(false);
    expect(questionSchema.safeParse({ ...validQuestion, source: "x" }).success).toBe(false);
  });

  it("rejects VO filenames not derived from the item id (QA-M0-8)", () => {
    expect(questionSchema.safeParse({ ...validQuestion, vo: "q_9999.ogg" }).success).toBe(false);
    expect(
      questionSchema.safeParse({ ...validQuestion, banterVo: "q_9999_banter.ogg" }).success,
    ).toBe(false);
    expect(
      questionSchema.safeParse({ ...validQuestion, banterVo: "q_0001_banter.ogg" }).success,
    ).toBe(true);
  });

  it("rejects control/invisible characters in rendered text (SEC-M0-6)", () => {
    expect(questionSchema.safeParse({ ...validQuestion, text: "chalo\u200Bab aage badho" }).success).toBe(false);
    expect(
      questionSchema.safeParse({ ...validQuestion, options: ["ek", "do", "teen", "chaar"] }).success,
    ).toBe(false);
  });

  it("rejects over-long options (SEC-M0-6)", () => {
    expect(
      questionSchema.safeParse({
        ...validQuestion,
        options: ["x".repeat(81), "do", "teen", "chaar"],
      }).success,
    ).toBe(false);
  });

  it("rejects finale categories with too few or too many true fits", () => {
    const base = {
      id: "f_0001",
      title: "Sample category title",
      vo: "f_0001.ogg",
      adult: false,
      source: "sample fixture",
    };
    const opts = (fits: number, total: number) =>
      Array.from({ length: total }, (_, i) => ({ text: `opt ${i}`, fits: i < fits }));
    expect(finaleCategorySchema.safeParse({ ...base, options: opts(1, 6) }).success).toBe(false);
    expect(finaleCategorySchema.safeParse({ ...base, options: opts(6, 8) }).success).toBe(false);
    expect(finaleCategorySchema.safeParse({ ...base, options: opts(3, 6) }).success).toBe(true);
    expect(finaleCategorySchema.safeParse({ ...base, vo: "f_0002.ogg", options: opts(3, 6) }).success).toBe(false);
  });

  it("rejects bad prompts and spelling words", () => {
    expect(
      promptSchema.safeParse({ id: "pw_0001", text: "achha prompt hai", vo: "pw_0002.ogg", adult: false }).success,
    ).toBe(false);
    expect(
      spellingWordSchema.safeParse({ id: "sw_0001", word: "abcdefghi", vo: "sw_0001.ogg", adult: false }).success,
    ).toBe(false);
    expect(
      spellingWordSchema.safeParse({ id: "sw_0001", word: "Samosa", vo: "sw_0001.ogg", adult: false }).success,
    ).toBe(false);
    expect(
      spellingWordSchema.safeParse({ id: "sw_0001", word: "samosa", vo: "sw_0002.ogg", adult: false }).success,
    ).toBe(false);
  });
});

describe("bank invariants (QA-M0-9, UT-M0-11)", () => {
  const makeBank = (corrects: number[]): Question[] =>
    corrects.map((c, i) =>
      questionSchema.parse({
        ...validQuestion,
        id: `q_${String(i + 1).padStart(4, "0")}`,
        vo: `q_${String(i + 1).padStart(4, "0")}.ogg`,
        correct: c,
      }),
    );

  it("detects duplicate ids in any bank", () => {
    expect(checkUniqueIds([{ id: "f_0001" }, { id: "f_0001" }])).toEqual(["duplicate id f_0001"]);
    expect(checkUniqueIds([{ id: "a" }, { id: "b" }])).toEqual([]);
  });

  it("flags over- and under-represented correct positions", () => {
    // index 0 correct for 12/20 (60%) and index 3 never correct
    const bank = makeBank([...Array(12).fill(0), ...Array(4).fill(1), ...Array(4).fill(2)]);
    const problems = checkBankInvariants(bank);
    expect(problems.some((p) => p.includes("index 0 is over-represented"))).toBe(true);
    expect(problems.some((p) => p.includes("index 3 is under-represented"))).toBe(true);
  });

  it("flags mechanical file-order cycles even when counts are balanced", () => {
    const bank = makeBank(Array.from({ length: 24 }, (_, i) => i % 4));
    const problems = checkBankInvariants(bank);
    expect(problems.some((p) => p.includes("file-order cycle"))).toBe(true);
  });

  it("accepts a balanced, non-cyclic bank", () => {
    const bank = makeBank([1, 3, 2, 0, 2, 1, 0, 3, 3, 1, 0, 2, 2, 0, 3, 1, 0, 2, 1, 3]);
    expect(checkBankInvariants(bank)).toEqual([]);
  });
});
