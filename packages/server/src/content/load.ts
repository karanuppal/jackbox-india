import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  finaleBankSchema,
  promptBankSchema,
  questionBankSchema,
  spellingBankSchema,
  type FinaleCategory,
  type Prompt,
  type Question,
  type SpellingWord,
} from "@tamasha/shared";

function contentDir(dir?: string): string {
  return dir ?? fileURLToPath(new URL("../../../../content/", import.meta.url));
}

/** Load and validate the trivia question bank from /content (§6). */
export function loadQuestionBank(dir?: string): Question[] {
  const raw = JSON.parse(readFileSync(contentDir(dir) + "questions.json", "utf8"));
  return questionBankSchema.parse(raw);
}

/** Khooni Kamra content pools (§3.4 K4/K5/K6). */
export interface KamraContent {
  spellingWords: SpellingWord[];
  worstPrompts: Prompt[];
  drawPrompts: Prompt[];
}

export function loadKamraContent(dir?: string): KamraContent {
  const base = contentDir(dir);
  return {
    spellingWords: spellingBankSchema.parse(JSON.parse(readFileSync(base + "spelling.json", "utf8"))),
    worstPrompts: promptBankSchema.parse(JSON.parse(readFileSync(base + "prompts-worst.json", "utf8"))),
    drawPrompts: promptBankSchema.parse(JSON.parse(readFileSync(base + "prompts-drawing.json", "utf8"))),
  };
}

/** Aakhri Darwaza finale categories (§3.6, used from M4). */
export function loadFinaleBank(dir?: string): FinaleCategory[] {
  return finaleBankSchema.parse(JSON.parse(readFileSync(contentDir(dir) + "finale.json", "utf8")));
}
