import { z } from "zod";

// Content schemas per PLAN.md §6.2. The /content JSON banks are validated
// against these in CI (packages/shared/test/content.test.ts).

export const CATEGORIES = [
  "bollywood",
  "regional-cinema",
  "classic-films",
  "cricket",
  "sports",
  "food",
  "tv-ott",
  "ads-jingles",
  "music",
  "internet",
  "daily-life",
  "history-geo",
  "science-absurd",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const questionSchema = z.object({
  id: z.string().regex(/^q_\d{4}$/),
  text: z.string().min(10).max(220),
  textRoman: z.boolean().default(true),
  options: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  correct: z.number().int().min(0).max(3),
  categories: z.array(z.enum(CATEGORIES)).min(1).max(3),
  difficulty: z.number().int().min(1).max(3),
  adult: z.boolean(),
  vo: z.string().regex(/^q_\d{4}\.ogg$/),
  banterVo: z
    .string()
    .regex(/^q_\d{4}_banter\.ogg$/)
    .optional(),
  source: z.string().min(5), // mandatory citation/curation note (§6.5)
  era: z.enum(["evergreen", "90s", "2000s", "recent"]),
});
export type Question = z.infer<typeof questionSchema>;

export const finaleOptionSchema = z.object({
  text: z.string().min(1).max(60),
  fits: z.boolean(),
});

export const finaleCategorySchema = z.object({
  id: z.string().regex(/^f_\d{4}$/),
  title: z.string().min(5).max(120),
  vo: z.string().regex(/^f_\d{4}\.ogg$/),
  adult: z.boolean(),
  options: z.array(finaleOptionSchema).min(6).max(8),
  source: z.string().min(5),
});
export type FinaleCategory = z.infer<typeof finaleCategorySchema>;

export const promptSchema = z.object({
  id: z.string().regex(/^(pw|pd)_\d{4}$/), // pw = worst-answer, pd = drawing
  text: z.string().min(5).max(140),
  vo: z.string().regex(/^(pw|pd)_\d{4}\.ogg$/),
  adult: z.boolean(),
});
export type Prompt = z.infer<typeof promptSchema>;

export const spellingWordSchema = z.object({
  id: z.string().regex(/^sw_\d{4}$/),
  word: z
    .string()
    .min(5)
    .max(8)
    .regex(/^[a-z]+$/, "lowercase ascii only — shown on scrambled keys"),
  adult: z.boolean(),
});
export type SpellingWord = z.infer<typeof spellingWordSchema>;

export const questionBankSchema = z.array(questionSchema);
export const finaleBankSchema = z.array(finaleCategorySchema);
export const promptBankSchema = z.array(promptSchema);
export const spellingBankSchema = z.array(spellingWordSchema);

/** Cross-item invariants beyond per-item shape (PLAN.md §6.2). */
export function checkBankInvariants(questions: Question[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) problems.push(`duplicate id ${q.id}`);
    ids.add(q.id);
  }
  // Correct-answer position balance: no index may exceed 40% of the bank
  // once the bank is non-trivial (uniform would be 25%).
  if (questions.length >= 20) {
    const counts = [0, 0, 0, 0];
    for (const q of questions) counts[q.correct]! += 1;
    for (let i = 0; i < 4; i++) {
      if (counts[i]! / questions.length > 0.4) {
        problems.push(
          `correct-answer index ${i} is over-represented: ${counts[i]}/${questions.length}`,
        );
      }
    }
  }
  return problems;
}
