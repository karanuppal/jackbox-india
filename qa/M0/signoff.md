# M0 Gate — Findings Resolution & Sign-off

Reviewed commit: `709447f` · Fix commit: `33d6934` · Full reports:
`qa-report.md`, `security-report.md`, `user-test-report.md` in this directory.

**49 findings total. All 49 addressed — none deferred, none waived.**
Three findings are protocol-design notes whose *enforcement point* is the M1
WebSocket layer (marked ⏳); the schema/constants/documentation part of each
was landed now, and each is restated in the M1 definition of done.

## Security (14)

| ID | Resolution | Covering test |
|----|-----------|---------------|
| SEC-M0-1 crash on malformed request-target | try/catch around URL parse (400), `clientError` handler, process-level guards, throwing-handler guard in `buildServer` | `http.test.ts` "robustness", "handler exception guard" |
| SEC-M0-2 password in public state | `toPublicSettings()` strips it; `RoomPublicState.settings` is `PublicSettings` | `protocol.test.ts` "toPublicSettings strips the password" |
| SEC-M0-3 no name validation | `sanitizeName` + `playerNameSchema` (NFC, control/bidi/zero-width strip, zalgo cap, 12-char cap) | `protocol.test.ts` "sanitizeName" suite (7 tests) |
| SEC-M0-4 unbounded questionId | `^q_\d{4}$` regex in `ksActionSchema` | "enforces question id format" |
| SEC-M0-5 no role binding | actions split into `vipActionSchema`/`hostActionSchema`/game envelope + `ACTION_ROLE` map; server enforcement is an M1 DoD item ⏳ | "every action has a declared role requirement" |
| SEC-M0-6 unbounded options | `displayString(1,80)` + control-char refinement on all rendered content | content rejection tests |
| SEC-M0-7 vitest/vite advisories | vitest 3.2.6 / vite 6.4.3; `pnpm audit` verified clean | audit run (see below) |
| SEC-M0-8 mutable action tags | all three actions pinned to commit SHAs | ci.yml review |
| SEC-M0-9 no permissions block | `permissions: contents: read` | ci.yml review |
| SEC-M0-10 no security headers | `x-content-type-options: nosniff` + cache-control on every response; CSP/HSTS planned at TLS layer | `http.test.ts` header assertions |
| SEC-M0-11 frame cap unenforced | constant documented as M1 ws receive-path requirement ⏳ (no ws layer exists yet) | pinned-constant test |
| SEC-M0-12 seq replay | monotonic-seq requirement documented in protocol; M1 enforcement ⏳ | envelope rejection tests (schema part) |
| SEC-M0-13 room-code enumeration | TTL + rate-limit constants (`ROOM_CODE_TTL_MS`, `LOOKUP_RATE_LIMIT_PER_MIN`, `WS_MESSAGES_PER_SEC`) + blocklist; M1 join-path enforcement ⏳ | pinned-constant + blocklist tests |
| SEC-M0-14 unmanaged build scripts | `pnpm.onlyBuiltDependencies: ["esbuild"]` committed | package.json review |

## QA (20)

| ID | Resolution |
|----|-----------|
| QA-M0-1 | `version:` input removed from pnpm/action-setup (reads `packageManager`) |
| QA-M0-2 | Dockerfile (multi-stage, serves SPA), docker CI job, static serving in server; staging URL amended in PLAN §10.2 (owner credentials needed) |
| QA-M0-3 | dead `build` script removed from shared |
| QA-M0-4 | `pnpm build` step added to CI |
| QA-M0-5 | q_0010 reworded to pin the famous Gravity comparison |
| QA-M0-6 | `validate:content` now runs the real content test file; dedicated CI step added |
| QA-M0-7 | spelling schema + data carry `vo` |
| QA-M0-8 | `superRefine` ties `vo`/`banterVo` to item id on every schema |
| QA-M0-9 | `checkUniqueIds` for all banks; under-representation bound added |
| QA-M0-10 | 2–5 fits enforced in `finaleCategorySchema` itself |
| QA-M0-11 | full negative-fixture rejection suite added |
| QA-M0-12 | `resolveRoute` extracted & injectable path; all routes tested |
| QA-M0-13 | `<title>` injected from `BRANDING` via Vite plugin; tests assert the constant |
| QA-M0-14 | v8 coverage thresholds enforced in every package's test run (CI runs them) |
| QA-M0-15 | trivia action moved out of platform protocol into `ksActionSchema` behind the opaque game envelope |
| QA-M0-16 | wire shapes recorded in PLAN Amendments; all server messages carry `seq` |
| QA-M0-17 | PLAN amendment: audio-pipeline/assets land at M6 |
| QA-M0-18 | CI concurrency group with cancel-in-progress |
| QA-M0-19 | `ROOM_CODE_TTL_MS` + Hindi/English blocklist constants with tests |
| QA-M0-20 | pinned-constants test asserts §3.2 values |

## User testing (15)

| ID | Resolution |
|----|-----------|
| UT-M0-1/2/3 | exact-match, case-insensitive routing; deliberate in-voice unknown-route screen with link home |
| UT-M0-4 | "Scaffold (M0)" removed; test forbids /scaffold|M0|milestone/i in rendered copy |
| UT-M0-5 | SVG favicon (diya motif) linked |
| UT-M0-6 | per-route `document.title`; jsdom test |
| UT-M0-7 | HEAD /healthz → 200 |
| UT-M0-8 | 405 + `Allow: GET, HEAD` on known path, wrong method |
| UT-M0-9 | in-voice `<noscript>` fallback |
| UT-M0-10 | q_0010 reworded (same fix as QA-M0-5) |
| UT-M0-11 | correct positions re-permuted (6/6/6/6, 6/24 cycle hits); cycle check added to invariants |
| UT-M0-12 | "gaaya tha" |
| UT-M0-13 | "medal chook gayi thin" |
| UT-M0-14 | q_0001 distractors made structurally parallel |
| UT-M0-15 | `preview` script added |

## Verification state

- Full suite after fixes: **64 tests, 0 failures; 100% statement coverage in
  all three packages; thresholds enforced.**
- `pnpm audit` (prod and dev): no known vulnerabilities.
- Production serving smoke-tested locally (healthz, SPA index, SPA fallback,
  immutable asset caching). Docker daemon unavailable in the dev sandbox;
  image build runs as a CI job.

## Re-review round (fix commit `33d6934` reviewed; second fix pass follows)

- **QA Reviewer re-review: SIGN-OFF YES.** All 20 resolved; verified coverage
  gate actually fails when forced; no new blockers. Advisories (non-blocking):
  ACTION_ROLE vocab to reconcile in M1; `finale.json` f_0003 Haider proximity
  to §6.4 — **actioned:** f_0003 swapped to a Gulzar-directs category.
- **User Tester re-review: SIGN-OFF YES.** All 15 re-verified by live testing;
  zero new findings.
- **Security Reviewer re-review: SIGN-OFF NO (3 new).** All 14 originals
  confirmed resolved (SEC-M0-1 crash re-exploited live — process survives), but
  the fixes introduced 3 new issues, now fixed:
  - SEC-M0-R1 (Medium) invisible/blank name bypass → `sanitizeName` extended to
    strip braille blank, Hangul/other fillers, mongolian vowel separator,
    standalone variation selectors, tag block; requires ≥1 visible glyph and
    strips leading combining marks. Tests: "invisible-character bypass" (5).
  - SEC-M0-R2 (Low) Docker runs as root → `USER node` added.
  - SEC-M0-R3 (Low) no `.dockerignore` → added; runtime stage copies only the
    built workspace from the build stage.
- **Global Tester: GLOBAL SUITE RED** (flaky) → fixed: `pnpm test` now runs
  `--workspace-concurrency=1`, eliminating the `@vitest/coverage-v8` temp-file
  race. Verified GREEN on 4 consecutive clean runs.

### State after second fix pass (commit pending)
- Full suite: **69 tests, 0 failures, 0 skipped; 100% statement coverage all
  packages; thresholds enforced; 4/4 consecutive green runs.**
- `pnpm audit`: clean. Build/typecheck: clean.
- Re-dispatching Security re-review + Global Tester for final confirmation.
