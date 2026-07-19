# M1 Gate — Findings Resolution & Sign-off

Reviewed commit: `144d880` · Fix commits: `335f249`, `<hardening>` · Milestone: M1
(platform core — rooms, join, lobby, VIP, reconnect, pause, settings shell).

**26 findings total (Security 5, QA 14, User 7). All 26 resolved.** Plus 2
reviewer hardenings applied in round 2 (Security INFO-1, QA non-blocking note).

## Round 1 → fixes (see commit 335f249 for the full mapping)

- **Security (5):** SEC-M1-1 room-create cap + per-IP rate limit; SEC-M1-2
  per-IP lookup/join throttle (dead constant now enforced); SEC-M1-3 per-IP
  socket cap + join-handshake timeout; SEC-M1-4 timing-safe secret compares;
  SEC-M1-5 caller role → engine via ActionMeta.
- **QA (14):** QA-M1-1 (BLOCKER) client seq baseline reset on reconnect;
  QA-M1-2 overlapping-socket eviction; QA-M1-3 VIP reassignment; QA-M1-4
  host-absence teardown; QA-M1-5 host-token persistence; QA-M1-6 settings UI +
  password join; QA-M1-7/8 PLAN amendments (controller-only start; skipTutorial
  → M2); QA-M1-9 VIP code reveal; QA-M1-10 pause freezes game input; QA-M1-11
  uniqueName cap; QA-M1-12 audience no avatar; QA-M1-13 name-based rejoin;
  QA-M1-14 Hinglish error mapping. UT-M1-6 avatar art → M7 (PLAN amendment).
- **User (7):** UT-M1-1 Hinglish errors + form-side name validation; UT-M1-2
  in-character host text; UT-M1-3 self-hosted Yatra One + Baloo 2 fonts;
  UT-M1-4 cross-device name reconnect; UT-M1-5 interactive settings + password
  field; UT-M1-7 name-edge feedback.

## Round 2 re-reviews

- **QA Reviewer: SIGN-OFF YES.** 14/14 verified against source with
  behavior-pinning tests (confirmed the blocker's test fails if reverted). No
  new defects. Flagged one pre-existing non-blocking gap (error at seq 0 after
  reconnect dropped) → **fixed** (store exempts `error` from the stale guard).
- **Security Reviewer: SIGN-OFF YES.** 5/5 resolved under live exploitation;
  name-reconnect confirmed safe (disconnected seats only, behind code +
  password). INFO-1 (name-reclaim returns original token) → **hardened**: a
  fresh token is minted on reclaim.
- **User Tester: SIGN-OFF YES.** 7/7 re-verified in a real headless browser
  (fonts load, cross-device rejoin reclaims the seat, settings toggle, password
  flow, Hinglish errors). Zero new.

## Verification state

- Full suite: **197 tests** (42 shared + 95 server + 60 client), 0 failures,
  0 skipped; all packages above coverage thresholds; typecheck + build clean
  (fonts bundled); `pnpm audit` clean.
- Global Tester full-suite determinism run: **pending** (dispatched).
