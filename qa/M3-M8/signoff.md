# Review-gate signoff — Milestones M3–M8 (2026-07-26)

Process per PLAN §8.3: dedicated QA, Security, and User-tester agents review at
each milestone's end; every finding — any severity — is fixed (or PLAN-pinned
with the reviewer's assent) before the gate closes; the Global Tester then runs
the complete suite.

## Verdicts

| Gate | QA | Security | User tester |
|---|---|---|---|
| M3 Khooni Kamra | SIGNOFF (after QA-M3-1..17 fixed) | SIGNOFF (after SEC-M3-1..7 fixed) | SIGNOFF (after UT-M3-1..14 fixed) |
| M4 Aakhri Darwaza | SIGNOFF (after QA-M4-1..9 + FINAL-1 fixed) | SIGNOFF (SEC-M4-1 fixed) | SIGNOFF (UT-M4-1..5 fixed) |
| M5 Content bank | SIGNOFF (FINAL-2 top-up: 540q/105 adult, 63+62 prompts, 126 words, 80 categories) | SIGNOFF (7078-string codepoint sweep clean) | SIGNOFF (in-game render + variety verified) |
| M6 Audio (feasible: synthesized SFX; TTS VO blocked on owner keys) | — | — | SIGNOFF (unlock/toggle/no-errors verified) |
| M7 Moderation/stats/share/polish | SIGNOFF (QA-M7-1..4 fixed) | SIGNOFF (SEC-M7-1..3 fixed) | SIGNOFF (UT-M5/M7-1..4 fixed) |
| M8 Load test | 200-room soak PASS: 0 errors, 0.14 MB retained growth, RTT p95 0.32 ms, clean 429s | | |

## Highlights of what the gates caught and fixed
- Party-killers: host-reload permanently bricking rooms (UT-M3-1); kick
  softlocking untimed rooms (QA-M7-2); VIP censor as an assassination/immunity
  lever (SEC-M3-4/QA-M3-3/UT-M3-2).
- Cheats: memory-game answers streaming to phones (SEC-M3-3); lazy/spray
  scoring dominance (QA-M3-1/QA-M4-1); idle finale runners creeping to steals
  (UT-M4-2) and disconnected runners scoring via empty locks (FINAL-1); sybil
  audience voting (SEC-M4-1); /mod self-promotion in password-less rooms
  (QA-M7-1).
- Text safety: kmAnswer bidi/zalgo/profanity pipeline (SEC-M3-1/6, QA-M3-6);
  4KB frame overflow silently truncating drawings (SEC-M3-2).
- Feel: personal reveal fates, wheel odds + fair spin order, vote tension
  (hidden tallies + fatal-entry payoff), kamra spectator info, finale track
  ticks/darkness telegraph, kicked-player notice, copy feedback.

Full reports live in the session transcripts; every fix carries a regression
test (378 tests at gate close).

## Deliberate deviations (PLAN amendments, all reviewer-assented)
Solo mercy; wheel spin-cap-free; kamra timers double under extended/off; ghosts
vote; censor = content-hiding only; barrier crossing interpretation; no-lock-
no-movement; kick-is-not-a-ban; post-hoc moderation scope; K1 operand floors.

## Outstanding (owner-blocked)
- Cloud Run deployment + live-deployment testing: awaiting GCP_SA_KEY /
  GCP_PROJECT_ID environment secrets (deploy script staged).
- M6 TTS voiceover bake-off (Sarvam vs ElevenLabs): needs owner-held provider
  keys; all VO lines ship as subtitles meanwhile.

## Live-deployment gate (2026-07-26, credential-free staging)

Since Cloud Run secrets were still pending, the live gate ran on a real
public deployment anyway: a GitHub Actions runner boots the production
server (`tsx src/main.ts` + built client) behind a Cloudflare quick tunnel,
and `scripts/live-fleet.mjs` plays full games over the PUBLIC https/wss URL
with 1 host-screen browser + 3 phone-viewport browsers (iPhone UA, touch).
Results land on the `staging-test-results` branch per run.

| Run | URL host | Verdict | Coverage |
| --- | --- | --- | --- |
| #1 (86604e3) | carbon-televisions-…trycloudflare.com | PASS, 0 console errors | 2 sawaal, group Spelling Shelling, last-one-standing early finale, ghost-crown Natija, prefilled rejoin |
| #2 (dc1b478) | interstate-literary-… | PASS, 0 console errors | solo Hisaab-Kitaab (19 sahi), group Yaaddasht, 13-chakkar finale with darkness eliminations |
| #3 (afa6e78) | screen-bag-commercial-… | PASS, 0 console errors | Sabse Ghatiya Jawaab + vote, Zeher Wali Chai, solo math, solo spelling, 8 sawaal, post-fix UI verified live |
| #4 (ed95543) | untitled-bibliographic-… | PASS, 0 console errors, ZERO stalls | final clean gate: full game 129s, all harness fixes verified, tunnel left up ~5h for human play |

Reviewer agents audited run #1's 37 screenshots (art-director + game-feel
lenses): AESTHETICS PASS + GAME-FEEL PASS with 14 findings, ALL fixed and
regression-tested (AES-LIVE-1..12, GF-LIVE-1..6; 379 → 384 tests):
- Host: bright question tiles + bold tally chips; one couch-sized centered
  SubtitleBand on every scene; taller finale track with name chips; hero
  Natija winner (no duplicate podium strip, tie-aware stats, no
  winner-repeating stat); readable join URL; vertically centered stage with
  diya-row set-dressing; quieter settings tray ("Lambe timers").
- Phones: instant local answer-lock feedback; persistent finale role banner
  (zinda/aatma/audience + chakkar + door distance) so a runner's phone never
  matches a ghost's; early-finale bridge line; personal winner verdict +
  VIP rematch hint; play-again button no longer browser-gray.
Fix verification: run #3 screenshots show all of the above live.

Test-harness-only bugs found (game unaffected, server kept perfect state
through both): Playwright 30s default timeouts on stale spelling-key
locators froze the BOT loop ~124s in runs #1/#3 — fixed by snapshotting
element handles with bounded reads.

Not exercised live (covered by unit/integration suites instead): Maut Ka
Chakra wheel (chance-gated; 208 server tests incl. odds/fairness), /mod
portal over the tunnel (room-level tests cover kick/censor), audience role.
