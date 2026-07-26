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
