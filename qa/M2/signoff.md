# M2 Gate — Findings Resolution & Sign-off

Milestone: M2 (Khooni Sawaal trivia loop — tutorial, 10 questions, scoring,
ghosts, mercy, reveal, game over, subtitles).

**21 original findings (Security 3, QA 10, User 8) + 6 re-review follow-ups,
all resolved.**

## Round 1 (see commit history for full mapping)
- Security (3): SEC-M2-1 no-timer disconnect deadlock; SEC-M2-2 hub timer
  teardown/code-reuse; SEC-M2-3 empty-selection crash.
- QA (10): QA-M2-1 (BLOCKER) pause busy-loop; QA-M2-2 disconnect deadlock;
  QA-M2-3 solo ends after Q1; QA-M2-4 empty bank; QA-M2-5 timer teardown;
  QA-M2-6 document deferral; QA-M2-7 wire ksActionSchema; QA-M2-8 loader
  untested; QA-M2-9 dead code; QA-M2-10 audience no-op buttons.
- User (8): UT-M2-1 name the dead; UT-M2-2 podium money/ghost; UT-M2-3
  countdown; UT-M2-4 answer-lock diya; UT-M2-5 VIP skip; UT-M2-6 play-again;
  UT-M2-7 tally legend; UT-M2-8 death visibility.

## Re-review follow-ups
- QA-M2-6: PLAN §11 M2 amendment added (wheel→M3/M4, finale→M4, direct
  wrong→ghost death, Khooni Kamra→M3).
- QA-M2-R1 / SEC-M2-R1: empty-selection fallback now respects family-friendly
  (all-adult bank in FF mode → gameOver, never serves adult content).
- QA-M2-R2: the pause busy-loop regression test was ineffective → rewritten
  with an injectable hub timer scheduler + deterministic FakeTimers; verified
  it fails when the guard is reverted.
- UT-M2-R1: lock badge gated to the question phase only.
- Global Tester flake: the QA-M2-R2 test was wall-clock-racy → made fully
  deterministic (injected clock + fake timers).

## Final gate
- **QA Reviewer: SIGN-OFF YES** (round 3).
- **Security Reviewer: SIGN-OFF YES** (fuzz clean, no new blocking findings).
- **User Tester: SIGN-OFF YES** (full game in a real browser).
- **Global Tester: GLOBAL SUITE GREEN** — 8/8 full-suite runs + 10/10 ksHub
  hammer runs deterministic; 249 tests; coverage above thresholds; zero skips.

**M2 CLEARED — 2026-07-19.** Proceeding to M3 (Khooni Kamra killing-floor:
8 minigames, drawing canvas, voting, VIP censor, Maut Ka Chakra wheel;
playtest gate #1).
