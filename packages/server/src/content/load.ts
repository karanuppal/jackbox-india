import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { questionBankSchema, type Question } from "@tamasha/shared";

/** Load and validate the trivia question bank from /content (§6). */
export function loadQuestionBank(dir?: string): Question[] {
  const base = dir ?? fileURLToPath(new URL("../../../../content/", import.meta.url));
  const raw = JSON.parse(readFileSync(base + "questions.json", "utf8"));
  return questionBankSchema.parse(raw);
}
