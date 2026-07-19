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

// Every rendered content string must be free of control/bidi/zero-width
// characters (SEC-M0-6) — content is repo-controlled but still lands on the
// shared screen and in TTS input.
const CONTROL_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/u;
const displayString = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !CONTROL_CHARS.test(s), "control/invisible characters forbidden");

export const questionSchema = z
  .object({
    id: z.string().regex(/^q_\d{4}$/),
    text: displayString(10, 220),
    textRoman: z.boolean().default(true),
    options: z.tuple([
      displayString(1, 80),
      displayString(1, 80),
      displayString(1, 80),
      displayString(1, 80),
    ]),
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
  })
  .superRefine((q, ctx) => {
    // VO assets are keyed to the item id (QA-M0-8).
    if (q.vo !== `${q.id}.ogg`) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `vo must be ${q.id}.ogg` });
    }
    if (q.banterVo !== undefined && q.banterVo !== `${q.id}_banter.ogg`) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `banterVo must be ${q.id}_banter.ogg` });
    }
  });
export type Question = z.infer<typeof questionSchema>;

export const finaleOptionSchema = z.object({
  text: displayString(1, 60),
  fits: z.boolean(),
});

export const finaleCategorySchema = z
  .object({
    id: z.string().regex(/^f_\d{4}$/),
    title: displayString(5, 120),
    vo: z.string().regex(/^f_\d{4}\.ogg$/),
    adult: z.boolean(),
    options: z.array(finaleOptionSchema).min(6).max(8),
    source: z.string().min(5),
  })
  .superRefine((c, ctx) => {
    if (c.vo !== `${c.id}.ogg`) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `vo must be ${c.id}.ogg` });
    }
    // §6.2: 2–5 genuinely-true fits per category (QA-M0-10 — schema-level).
    const fits = c.options.filter((o) => o.fits).length;
    if (fits < 2 || fits > 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `category must have 2-5 true fits, has ${fits}`,
      });
    }
  });
export type FinaleCategory = z.infer<typeof finaleCategorySchema>;

export const promptSchema = z
  .object({
    id: z.string().regex(/^(pw|pd)_\d{4}$/), // pw = worst-answer, pd = drawing
    text: displayString(5, 140),
    vo: z.string().regex(/^(pw|pd)_\d{4}\.ogg$/),
    adult: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (p.vo !== `${p.id}.ogg`) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `vo must be ${p.id}.ogg` });
    }
  });
export type Prompt = z.infer<typeof promptSchema>;

export const spellingWordSchema = z
  .object({
    id: z.string().regex(/^sw_\d{4}$/),
    word: z
      .string()
      .min(5)
      .max(8)
      .regex(/^[a-z]+$/, "lowercase ascii only — shown on scrambled keys"),
    vo: z.string().regex(/^sw_\d{4}\.ogg$/), // §6.2: every content item has VO
    adult: z.boolean(),
  })
  .superRefine((w, ctx) => {
    if (w.vo !== `${w.id}.ogg`) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `vo must be ${w.id}.ogg` });
    }
  });
export type SpellingWord = z.infer<typeof spellingWordSchema>;

export const questionBankSchema = z.array(questionSchema).min(1);
export const finaleBankSchema = z.array(finaleCategorySchema);
export const promptBankSchema = z.array(promptSchema);
export const spellingBankSchema = z.array(spellingWordSchema);

/** Duplicate-id detection for any bank (QA-M0-9). */
export function checkUniqueIds(items: readonly { id: string }[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) problems.push(`duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return problems;
}

/** Cross-item invariants beyond per-item shape (PLAN.md §6.2). */
export function checkBankInvariants(questions: Question[]): string[] {
  const problems: string[] = [...checkUniqueIds(questions)];
  // Correct-answer position balance: with a non-trivial bank each index must
  // sit between 10% and 40% of items (uniform would be 25%) — both an over-
  // and an under-representation bound (QA-M0-9).
  if (questions.length >= 20) {
    const counts = [0, 0, 0, 0];
    for (const q of questions) counts[q.correct]! += 1;
    for (let i = 0; i < 4; i++) {
      const share = counts[i]! / questions.length;
      if (share > 0.4) {
        problems.push(
          `correct-answer index ${i} is over-represented: ${counts[i]}/${questions.length}`,
        );
      }
      if (share < 0.1) {
        problems.push(
          `correct-answer index ${i} is under-represented: ${counts[i]}/${questions.length}`,
        );
      }
    }
    // Guard against mechanical position cycles (UT-M0-11): the bank must not
    // follow `correct = k mod 4` in file order for most of its length.
    let cycleHits = 0;
    for (let k = 0; k < questions.length; k++) {
      if (questions[k]!.correct === k % 4) cycleHits += 1;
    }
    if (cycleHits / questions.length > 0.6) {
      problems.push(
        `correct-answer positions follow the file-order cycle for ${cycleHits}/${questions.length} items`,
      );
    }
  }
  return problems;
}
