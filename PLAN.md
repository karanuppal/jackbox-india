# TAMASHA — an Indian Jackbox-style party platform
## Master Plan & Design Decisions (v1 game: **Khooni Sawaal**)

> **Status:** All design decisions in this document are final for v1 unless explicitly
> marked OPEN. Nothing gets coded that contradicts this document; changes to it are
> deliberate, reviewed edits.
>
> **The one-line goal:** Replicate the Jackbox experience *exactly* — same
> architecture, same flow, same vibe, same polish bar — with zero new design
> judgments, except that every piece of content, art theming, and voiceover is
> fully localized to India (Hinglish, Indian pop culture, Indian humor).

---

## 0. Scope decisions (made with the owner, 2026-07-19)

| # | Decision | Choice |
|---|----------|--------|
| D1 | v1 game | **Trivia Murder Party-style** horror-comedy trivia (working title **Khooni Sawaal**). Other archetypes (Quiplash/Fibbage/Drawful-style) are future games on the same platform; the platform layer is built game-agnostic from day one. |
| D2 | Content policy | **Edgier, filter-gated.** Default experience is PG-13 irreverent; spicier adult-flagged items exist and are hidden by the Family-Friendly toggle (on by default: OFF filter = full content, mirroring Jackbox's default). **Politics, religion, and communal topics are entirely excluded at every tier** — see §6.4. |
| D3 | Voiceover engine | **Provider-agnostic pipeline; bake-off between Sarvam Bulbul v3 and ElevenLabs v3** on the same 20-line script; owner picks by ear. ~90% of VO is pre-generated static assets; runtime TTS only for player names / dynamic reads, cached. |
| D4 | Host language | **True Hinglish** — Hindi sentence backbone, English game/score vocabulary, KBC-meets-standup register. On-screen text: mostly English with Hindi flavor words in Roman script, Devanagari used as *display accent* (titles, stingers). |

---

## 1. What we are replicating (the Jackbox model, verbatim)

These are Jackbox's actual mechanics, confirmed by research; we adopt them without
modification:

1. **Asymmetric two-screen play.** One host screen runs "the show" (TV/laptop,
   shared via HDMI or screen-share). Players use their phone browsers as
   controllers — **no app install**. Controllers show only the minimal private
   controls for the current phase; all spectacle lives on the host screen.
2. **Room codes.** 4 uppercase letters, generated centrally, not case-sensitive,
   single-session lifetime. Join = enter code + name. Lobby also shows a QR code.
3. **Roles.** *Host screen* (the room authority display), *VIP* (first player to
   join; starts the game from their phone, can skip the tutorial, can censor
   player-submitted content), *players* (1–8 for this game), *audience*
   (joiners beyond the player cap or after start; they play along in aggregate),
   *moderator* (optional; password-gated portal that approves player-generated
   content before it hits the screen).
4. **Session rules.** Start gated on minimum player count via VIP's "Everybody's
   In" button; late joiners route to audience; disconnected players keep their
   seat and reconnect with the same code + session token; game continues while
   they're gone (their inputs default/skip); room dies when the host leaves.
5. **Settings surface** (lobby, pre-game):
   - *Content:* Family-Friendly filter, input profanity filter, Moderation on/off.
   - *Accessibility:* subtitles for all VO, extended timers, no timers,
     reduced motion.
   - *Gameplay:* audience on/off, passworded room, hide room code (streamer
     mode), start-from-controller-only, skip tutorial.
   - *Pause* from the host screen at any time, for everyone.
6. **The show structure.** In-character VO host narrates everything: lobby
   patter → skippable animated "how to play" tutorial → rounds → escalating
   stakes → finale → winner celebration → play-again/share screen.
7. **Content engine conventions.** 300–600 content items at ship; every item
   carries a family-friendly flag and (for a voice-acted game) a VO audio asset;
   answer positions balanced; selection prefers least-recently-shown; typed-input
   matching uses alternate-spellings lists.

**What we explicitly do NOT copy:** Jackbox names, logos, art assets, audio,
scripts, or question text. Mechanics and formats are not copyrightable; assets
and expression are. Everything we ship is original writing, original art
direction, original music, original VO. The product never references Jackbox.

---

## 2. Product identity

- **Platform brand (working title): `Tamasha`** — the jackbox.tv equivalent.
  Players join at the platform's join page (e.g. `tamasha.game` — final domain
  is an OPEN item pending availability check; the code never hardcodes the
  brand string outside one config file).
- **v1 game (working title): `Khooni Sawaal`** ("Murderous Question").
- Trademark/domain clearance is a pre-launch checklist item, not a blocker for
  development; both names live in `branding.ts` config so a rename is a
  one-file change.

---

## 3. Khooni Sawaal — complete game specification

A faithful port of the Trivia Murder Party ruleset with an Indian skin. Numbers
below are the shipping values (mirroring TMP where known).

### 3.1 Premise & setting

Late-night quiz show filmed inside **Manzil Mahal**, a decaying 1970s haveli-
turned-hotel straight out of a Ramsay Brothers horror film. The host,
**Mishra Ji**, is a soft-spoken, unfailingly courteous serial killer who has
"invited" the players to his quiz night. Losing a question sends you to the
**Khooni Kamra** (the murder room) for a deadly parlor game. Dead players
become **bhatakti aatmayein** (ghosts) who keep playing — and can steal a
living body during the final escape.

### 3.2 Player counts & audience

- **Players:** 1–8 (fully playable solo, like TMP).
- **Audience:** unlimited joiners beyond 8 (v1 hard cap 200 concurrent audience
  per room; the protocol treats audience as an aggregate so raising the cap is
  ops work, not design work). Audience members answer every trivia question
  (earning collective ₹ proportional to their correct rate, shown as a fun
  stat), wager on which player dies next, and vote in the voting-based Khooni
  Kamra games. Audience can be disabled in settings.

### 3.3 Main loop — the trivia phase

- The game plays a sequence of **question rooms** (default budget: 10 questions;
  fewer if attrition ends it early).
- Each question: **multiple choice, exactly 4 options**, read aloud by Mishra Ji
  (pre-generated VO per question). Everyone — alive and ghost — answers on
  their phone within the timer (**default 30s; extended-timer setting doubles;
  no-timer setting waits for all**).
- **Correct answer: +₹1,000** (each player independently).
- **Wrong answer (living players): sent to the Khooni Kamra.** Ghosts can't die
  again; they just don't earn.
- **Mercy rule:** if *every* living player answers wrong, Mishra Ji spares them
  ("Aaj sab ke sab nalayak nikle… chalo, maaf kiya.") — no Khooni Kamra, next
  question.
- If all living players answer correctly, skip straight to the next question
  with a grudging VO line.
- Money persists into ghosthood and determines final-round head starts.
- **Attrition end:** if the question budget is exhausted with 2+ players still
  alive, the **Maut Ka Chakra** (Wheel of Death) spins for each surviving
  player — 5 death segments : 1 life segment — until one living player remains.
  Then the finale starts.
- If only 1 player is alive at any point earlier, the finale starts immediately
  after the current question resolves.

### 3.4 The Khooni Kamra (killing-floor minigames)

At least one loser dies per visit (exactly mirroring TMP's design: some games
are skill, some memory, some pure luck, some social betrayal). If only one
player is on the floor, they face a solo game where death is possible but not
guaranteed (luck/skill games only). v1 ships **8 minigames**, each a localized
skin of a TMP mechanic:

| # | Name | Mechanic (verbatim TMP) | Indian skin |
|---|------|--------------------------|-------------|
| K1 | **Hisaab-Kitaab** | Rapid-fire mental math MCQs (add/subtract, integers < 20, negatives possible), ₹25 per correct, 30s; lowest tally dies | Sabzi-mandi ledger: "Bhindi ₹12, udhaar ₹7…" |
| K2 | **Yaaddasht** | Memorize highlighted tiles on a 4×4–6×6 grid, reproduce; ₹1,000 × proportion correct; worst dies | Carrom-board / rangoli tile patterns |
| K3 | **Taash Ke Patte** | Memorize 4–6 cards by color + symbol, answer recall questions | Teen-patti-style cards; symbols: kirpan, hockey stick, belan, hathoda |
| K4 | **Spelling Shelling** | Spell a shown 5–8 letter word from scrambled keys; ₹100 × word length | English words as spoken in India ("mischievous", "restaurant") plus transliterated Hindi ("khichdi", "shaadi") |
| K5 | **Sabse Ghatiya Jawaab** | All floor players answer an open prompt; everyone else votes for the answer they like LEAST; least-liked dies | Prompts in the house Hinglish voice; VIP-censorable; profanity-filtered |
| K6 | **Ganda Chitra** | Draw the prompt on the phone canvas; worst-voted drawing dies | Drawing prompts from the same content bank |
| K7 | **Zeher Wali Chai** | Pick one of N cups; one (or more) is poisoned — pure luck | Cutting-chai glasses on a tray; Mishra Ji: "Ek glass mein… thoda extra masala hai." |
| K8 | **Dhokha** | Betrayal split: each player secretly picks SPARE THEM or SAVE MYSELF; outcomes per TMP's loyalty games (if nobody betrays, all survive but forfeit money; betrayers profit if unique, die if everyone betrays) | Framed as "Rishtedaari Test" — family loyalty melodrama, full Bollywood strings |

Minigame selection: random without repeats until all 8 seen (per game session).
K5/K6 require ≥2 floor players and ≥1 living voter; the selector respects
these constraints (mirrors TMP).

### 3.5 Ghosts

- Dead players' avatars turn translucent-white with a floating chunni/shroud;
  they stay on the podium row, keep answering every question, and keep earning.
- Ghost money matters: the 3 richest ghosts get head starts in the finale.
- VO acknowledges deaths by name (runtime TTS name insert) with a rotating set
  of darkly courteous lines ("Bahut afsos hua, {name}. Chai thandi ho gayi na.").

### 3.6 Finale — **Aakhri Darwaza** (The Last Door)

Verbatim TMP "Exit" mechanics with localized dressing (pre-dawn escape from
Manzil Mahal as it collapses into darkness):

- A linear track of spaces leads to the exit door. The **living leader starts
  14 spaces from the exit**. The 3 richest ghosts start **3 / 2 / 1 spaces
  ahead of the ghost pack**; all other ghosts start **21 spaces** out.
- Each turn shows a **category** ("Movies where Shah Rukh plays a double role",
  "Street foods sold at Juhu Chowpatty") with **2 candidate options for the
  living player, 3 for ghosts** (and 3 in solo games). Any number of the
  options may genuinely fit the category.
- Players **toggle-select every option they believe fits**, then lock in.
  **Timer: 12 seconds, NOT extendable** (TMP2 rule — the finale ignores the
  extended-timer setting). You move **1 space per correct judgment** (selecting
  a true fit, or leaving a non-fit unselected).
- **Body stealing:** a ghost that reaches or passes the living player's space
  steals their body (closest ghost wins the steal; other tied ghosts get
  knocked back). The victim becomes a ghost at the pack position.
- **Darkness:** after 3 category turns (2 in solo), a wall of darkness sweeps
  from the far end, advancing 2–3 spaces per turn; anyone it catches is
  permanently eliminated from the finale.
- **Winning:** first player to cross the exit *while alive* wins the entire
  game, regardless of money. Money is the tiebreak framing only ("sabse amir
  laash" gag for the richest loser).
- **Barrier rule (TMP2):** the door has a final barrier 2 spaces out; breaking
  through requires a perfect 3-for-3 judgment turn. Adopted.
- **Audience in the finale:** the audience collectively races as one extra
  ghost runner (majority-vote judgments). If the audience runner wins, the
  in-fiction gag is "the public escapes" and the highest-money living player
  takes the crown (TMP2-style; audience can't actually win the trophy).

### 3.7 Scoring summary (all values final)

| Event | Value |
|---|---|
| Correct trivia answer | +₹1,000 |
| Khooni Kamra math (K1) | +₹25 per correct |
| Khooni Kamra memory (K2) | +₹1,000 × proportion correct |
| Spelling (K4) | +₹100 × word length |
| Dhokha (K8) payouts | Per TMP loyalty table: unique betrayer takes the pot; universal betrayal = all die; universal loyalty = survive, forfeit round money |
| Finale movement | 1 space per correct judgment |

No point multiplier rounds (TMP has none — money is flat; tension escalates via
deaths, not multipliers).

### 3.8 Tutorial & flow of a session

1. Host screen: title card → lobby (room code + QR, avatar podium fills as
   players join, Mishra Ji lobby patter lines every ~20s).
2. VIP taps **"Sab Aa Gaye!"** (Everybody's In) → skippable animated tutorial
   (~45s) narrated in character, demonstrating: answer on phone → wrong = Khooni
   Kamra → ghosts keep playing → escape at dawn.
3. 10-question loop with Khooni Kamra interruptions.
4. Maut Ka Chakra if needed → Aakhri Darwaza finale.
5. Winner celebration (confetti of marigold petals, winner avatar garlanded,
   full filmi fanfare) → stats screen (biggest fool, most deaths survived,
   richest ghost) → "Phir se khelein?" restart into a fresh lobby with the same
   room, same players, new code not required.

---

## 4. Platform specification (game-agnostic layer)

Everything in this section is built so a second game (Quiplash-style etc.) can
be added later by implementing a game module against the same interfaces.

### 4.1 System components

```
┌────────────────────────────────────────────────────────────┐
│  Node.js server (single process per region, ap-south-1)    │
│  • REST: room lookup/create, health, TTS cache endpoint    │
│  • WebSocket hub: rooms as in-memory state machines        │
│  • Game modules implement GameEngine interface             │
└────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
   Host screen SPA      Controller SPA       Moderator SPA
   (/host route)        (/ = join page)      (/mod route)
        └────────── one React app, three routes ──────────┘
```

- **Server:** Node 22 + TypeScript, `ws` (plain WebSockets — no socket.io), a
  hand-rolled finite-state machine per room (explicit phase enum + transition
  table; no XState dependency — the FSM is the heart of the product and stays
  fully under our control). Rooms are in-memory objects; no database for live
  play. Room registry maps `code → room`.
- **Why server-authoritative** (vs Jackbox's authoritative-host-client): all
  game logic, timers, and scoring run on the server; host screen and phones are
  pure renderers of server state + input senders. This makes reconnection,
  anti-cheat, and audience aggregation trivial, and is the standard modern
  approach for web-first Jackbox-likes.
- **Clients:** one React + TypeScript SPA (Vite). Routes: `/` join page
  (code + name), `/host` host screen, `/mod` moderator portal. Controller UI
  adapts per phase via a small component vocabulary (see §5.4).
- **Scaling model:** rooms are isolated; one process handles hundreds of rooms.
  Horizontal scale later = room-code → instance routing at the lookup endpoint
  (exactly Jackbox's ecast pattern). Not built in v1 beyond keeping the lookup
  indirection in place.

### 4.2 Protocol

- **Join flow:** `POST /api/rooms` (host screen creates room, receives host
  token + code) · `GET /api/rooms/:code` → `{exists, gameId, wsUrl, locked}` ·
  then `wss://…/play?code=…&token=…`.
- **Messages:** JSON `{seq, type, payload}`. Server → client messages are
  **role-scoped state snapshots + deltas**: host screen gets the full public
  state; each controller gets only its private view (its prompt, its options,
  its money). Client → server: `{action, payload}` inputs only.
- **Timers:** server sends `deadline` timestamps; clients render countdowns
  locally; server enforces the true deadline. Turn-based tolerance means
  100–300ms RTT is invisible.
- **Reconnect:** on first join the server issues a `sessionToken` (UUID,
  localStorage). Identity = token, not socket. On disconnect: seat held for the
  room's lifetime, avatar marked "signal gaya" on the host screen, inputs
  default (wrong/no answer, like TMP). On reconnect: full snapshot restore to
  the exact current phase view. Host-screen disconnect pauses the game for
  everyone (grace 5 min, then room teardown).
- **Room codes:** 4 letters from a 20-letter alphabet (ambiguous letters
  removed), profanity-checked against a Hindi+English blocklist, TTL 12h.

### 4.3 Roles & permissions

| Role | How acquired | Powers |
|---|---|---|
| Host screen | Created the room | Displays show; pause/resume; local settings menu pre-game |
| VIP | First player to join | Start game ("Sab Aa Gaye!"), skip tutorial, censor any player-submitted text/drawing (K5/K6) from their phone |
| Player | Join while slots open, pre-start | Play |
| Audience | Join after start/full (if enabled) | Aggregate answers, death wagers, K5/K6 votes, finale runner |
| Moderator | `/mod` + room's moderation password | Approve/reject player-submitted content before display; kick players (above min count mid-game) |

### 4.4 Settings (lobby, host screen, pre-game)

Content: **Family-Friendly filter** (default ON for v1 — flips the D2 "edgier"
tier off unless deliberately disabled; this inverts Jackbox's default and is a
deliberate India-market call, the only place we deviate — marked as such) ·
**profanity filter** for typed input (Hindi + English + Hinglish-transliteration
wordlist; strict mode rejects, lenient mode masks) · **Moderation** toggle
(generates password shown only on host screen).
Accessibility: **subtitles** (always-rendered VO captions, default ON) ·
**extended timers** (2×) · **no timers** · **reduced motion**.
Gameplay: **audience on/off** · **passworded room** · **hide room code**
(streamer mode; VIP phone can reveal) · **controller-only start** · **skip
tutorial**.

### 4.5 Post-game

Shareable results card (image generated client-side on the host screen:
winner, garland, stats, game logo) — download/share button on each controller.
No accounts, no persistence beyond a cookie-keyed "recent games" list on the
controller (mirrors jackbox.tv's past-games gallery, capped at 2 entries v1).

---

## 5. Design language (art direction — all decisions final)

### 5.1 The show

**Ramsay Brothers horror-comedy meets 90s Doordarshan quiz show.** This is the
Indian translation of TMP's "grindhouse VHS motel" — the exact same joke
(cheerful quiz chrome over slasher dressing) in a register every Indian player
recognizes: flickering tube-lights, damask wallpaper peeling over stone walls,
a brass diya that gutters when someone dies, VHS tracking artifacts and a
"Manzil Mahal" neon sign with dying letters.

- **Palette:** near-black maroon `#1a0508`, aged plaster `#e8dcc4`, blood/sindoor
  red `#c0182b`, marigold `#f5a623` (accents, winner celebration), tube-light
  cyan `#7fd8d8` (ghost tint), haldi cream for body text on dark.
- **Motifs:** marigold garlands (win state), chalk outlines drawn in rangoli
  patterns (death state), cutting-chai glasses, hand-painted Bollywood-poster
  lettering for stingers, film-grain + subtle VHS wobble overlay (disabled by
  reduced-motion setting).
- **Avatars:** 8 fixed doll-like characters in the TMP tradition, Indian
  wedding-guest wardrobe (safari suit uncle, kanjeevaram aunty, gym bro,
  shaadi photographer…). Ghost variant = translucent white + floating shroud.
  Original art, flat vector, slightly unsettling smiles.
- **Typography:** Display: **Yatra One** (Devanagari-flavored Latin display —
  the Bollywood-horror poster look, free/OFL). Body & UI: **Baloo 2**
  (rounded, high-legibility, full Devanagari + Latin, OFL). Numerals large and
  high-contrast for across-the-room readability; one dominant element per
  screen (Jackbox's streaming-legibility rule).
- **Animation:** phase transitions as film cuts (projector flicker / VHS
  rewind); money counters with mechanical-counter rolls; deaths staged as
  tasteful cartoon cutaways (shadow-play behind a curtain, never gore) — the
  "South Park not Saw" tonal rule.

### 5.2 Host screen layout grammar

Lobby: haveli facade, podium row of avatars, giant room code top-right (hidden
in streamer mode), QR bottom-left, settings gear. Question phase: question text
fills upper 60%, four answer cards below, per-player answer-lock indicators as
diya flames, timer as a burning incense stick. Reveal: correct card glows
marigold; wrong-answerers' avatars get yanked off-screen with a film-reel
scratch into the Khooni Kamra interstitial. Finale: side-scrolling corridor,
track spaces as floor tiles, darkness wall as ink flood, exit door with dawn
light.

### 5.3 Controller (phone) design

Jackbox's controller vocabulary, unchanged: **exactly four widget types** —
big-button grid (answers/choices), text field + submit, drawing canvas
(pointer-events, `touch-action:none`, stroke vectors, 2 colors, no eraser,
undo-last-stroke only), and a "watch the screen / wait" card (shows your
avatar + a one-line Hinglish quip). High contrast, ≥48px touch targets, no
chrome, portrait-locked layout, works on a 360×640 budget Android in Chrome —
**the performance floor is a ₹8,000 Android phone on Jio 4G.**

### 5.4 Vibe rules (writing + presentation)

Every string in the product is in-voice (error messages, buttons, loading
lines: "Ruko zara… sabar karo."). The host roasts players by name but never
punches down at groups. Fourth-wall jokes allowed. English UI verbs, Hinglish
flavor everywhere else.

---

## 6. Content system (the knowledge base)

### 6.1 Volumes (ship targets, mirroring TMP density)

| Content type | Ship count |
|---|---|
| Main trivia questions (4-option MCQ) | **500** (400 default-tier + 100 adult-flagged) |
| Finale categories (with 6–8 judgeable options each) | **80** |
| Khooni Kamra open prompts (K5 worst-answer) | **60** |
| Khooni Kamra drawing prompts (K6) | **60** |
| Spelling words (K4) | **120** |
| Host VO script lines (see §7) | ~**900** |

### 6.2 Question schema (JSON, one file per content type, validated in CI)

```jsonc
{
  "id": "q_0413",
  "text": "Sholay mein Basanti ki taange ke alawa kis cheez ka insurance karwaya gaya tha?",
  "textRoman": true,                    // rendering hint
  "options": ["Dhanno", "Thakur ki haveli", "Jai ka sikka", "Gabbar ki bandook"],
  "correct": 0,                          // index; positions balanced across bank
  "categories": ["bollywood", "classic-films"],
  "difficulty": 2,                       // 1–3, drives selection curve
  "adult": false,                        // D2 filter flag
  "vo": "q_0413.ogg",                    // pre-generated question read
  "banterVo": "q_0413_banter.ogg",       // optional intro joke, ~30% of questions
  "source": "Sholay (1975), famously insured Hema Malini's… [curation note]",
  "era": "evergreen"                     // evergreen | 90s | 2000s | recent
}
```

Finale categories: `{id, title, vo, options: [{text, fits: bool}]}` (2–5 true
fits per category). Prompts/spelling: `{id, text, vo, adult}`.

- **Selection:** least-recently-shown per room cookie cohort, difficulty curve
  easy→hard across the 10 questions, adult items only when filter is off,
  never two questions from the same category back-to-back.
- **Position balancing:** correct-answer index distribution kept uniform by a
  CI check.

### 6.3 The Indian content universe (what questions are about)

Target mix across the 500 questions — each item tagged, mix enforced by CI:

- **Bollywood & regional cinema (25%)** — classic + contemporary, on-screen
  trivia, iconic dialogues, absurd plot facts, filmi gossip that is public
  record. (South cinema, not just Hindi: RRR, Rajini lore, Malayalam new wave.)
- **Cricket & sports (15%)** — matches, records, IPL absurdities, Ranji
  obscurities, non-cricket greats (P.T. Usha, Dhyan Chand, chess, kabaddi).
- **Food (12%)** — street food geography, regional dish origins, the great
  debates (cutting chai, vada pav vs dabeli, biryani cartography).
- **TV, OTT & ads (10%)** — DD-era nostalgia (Shaktimaan, Malgudi Days),
  saas-bahu era, OTT hits, legendary ad jingles (Nirma, Vicco, Amul topicals).
- **Music (8%)** — film music, indie/pop (Lucky Ali to Divine), classical-lite.
- **Internet & meme culture (8%)** — public viral moments, YouTube/Insta-era
  celebrities, tech-in-India oddities. `era:"recent"` tagged for refresh cycles.
- **Daily desi life (10%)** — trains, weddings, monsoons, school nostalgia
  (Camlin geometry boxes, Milton bottles), jugaad engineering.
- **History & geography lite (7%)** — weird-but-true, non-political,
  non-communal only (princely-state oddities, "which city is called X of
  India").
- **Science/misc absurdia (5%)** — the Fibbage-grade weird-true-facts vein.

### 6.4 Hard content policy (non-negotiable, enforced in review)

**Banned at every tier:** politics (parties, politicians, elections, policy),
religion and religious figures/practices, caste, communal history or conflict,
Kashmir/borders/military operations, godmen/cults, tragedy/disaster jokes,
living-person sexual rumor or defamation-adjacent gossip, regional-stereotype
punchlines (a state can be the *setting*, never the *butt*).
**Adult tier (`adult:true`, filter-gated):** innuendo, body humor, drinking,
sanskaari-taboo cheek — Naughty-Pack-adjacent, never involving the banned list.
**Difficulty ethic:** questions must be *funny to get wrong* — every wrong
option is a joke, not filler (the Jackbox writing bar).

### 6.5 Content production pipeline

1. **Draft:** LLM-assisted generation against this section's spec, batched by
   category, each with source note.
2. **Fact-check:** every `correct` claim verified against a citable source;
   the `source` field is mandatory and CI-enforced non-empty.
3. **Voice pass:** human/editorial rewrite into the Mishra Ji register (§7.2).
4. **Policy pass:** checklist review against §6.4; sign-off recorded per batch.
5. **Balance pass:** CI scripts check category mix, difficulty curve, correct-
   index uniformity, duplicate detection (fuzzy-match on question text).
6. **VO generation:** §7.4 pipeline renders audio per item.

The content bank lives in-repo (`/content/*.json`) — reviewable in PRs like
code.

---

## 7. Voiceover & audio

### 7.1 The host: **Mishra Ji**

Soft-spoken, courteous, faintly amused, completely murderous — the TMP host
archetype rendered as a genteel UP-Hindi-belt hotelier. Register: formal-polite
Hindi ("aap", "kripya") that makes the menace funnier, breaking into gleeful
Hinglish when players fail. Voice treatment: warm mid-register + subtle
pitch/reverb "haveli" filter; occasional deliberate filter glitches as a
fourth-wall gag (TMP's signature trick).

Sample register (the calibration lines for the TTS bake-off):
- Lobby: "Aaiye aaiye… Manzil Mahal mein aapka swagat hai. Chai abhi garam hai. Aap… abhi zinda hain. Dono cheezein badlengi."
- Correct: "Wah, {name}! Ek hazaar rupaye. Kharch mat karna — yahan ki dukaanein… band ho chuki hain."
- Death: "Bahut afsos, {name}. Koi baat nahi. Marne ke baad bhi quiz chalta rahega. Yahi toh iss hotel ki khaasiyat hai."
- Finale: "Suraj nikalne wala hai. Darwaza khula hai. Bhaagiye. Main… peeche se aa raha hoon."

### 7.2 VO line taxonomy (~900 lines, all pre-generated)

| Bucket | Approx lines |
|---|---|
| Lobby patter (join reactions, idle loops, VIP nudges) | 60 |
| Tutorial narration | 20 |
| Question reads (1 per question) | 500 |
| Question banter intros (~30%) | 150 |
| Reveal/mercy/all-correct reactions | 40 |
| Khooni Kamra: per-minigame intros/rules/outcomes (8 games) | 96 |
| Ghost/death lines, wheel, finale narration, darkness warnings | 60 |
| Winner/stats/restart, settings/pause quips, error states | 40 |

Dynamic name insertion: name audio is generated at runtime (player joins →
server renders `{name}` clip via TTS, cached by text-hash), spliced into
pre-generated line templates at marked gap points. Fallback if TTS is
unreachable: lines render without the name (every template must read cleanly
nameless — a writing rule).

### 7.3 Easter eggs (the Jackbox signature)

- ~30 trigger names (Amitabh, Dhoni, Gabbar, Pushpa…) get one-shot recorded
  reactions at join.
- K5 answer sniffing: submitting certain words ("khooni sawaal", "mishra ji",
  "sanskaar") triggers bespoke host rants. One play per game.

### 7.4 TTS pipeline (D3)

- `audio-pipeline/` package: script-in-JSON → provider adapter → OGG assets +
  manifest. Adapters: **Sarvam Bulbul v3** and **ElevenLabs v3** behind one
  interface; provider choice is a build flag.
- **Bake-off protocol:** the 20 calibration lines (§7.1 plus timer/reveal/
  finale samples) rendered through both providers × 2–3 candidate voices each;
  output as a single comparison page (audio elements, blind A/B) for the owner
  to pick. Decision recorded here as an amendment before mass generation.
- Input format experiment included in bake-off: Devanagari script vs romanized
  Hinglish input (research says Devanagari input is safer for Hindi words).
- Runtime TTS (names) uses the same chosen provider; server-side, cached,
  ~1s latency masked by transition stingers.

### 7.5 Music & SFX

Original compositions (licensed-out or produced with royalty-free stems in
v1, replaceable): the TMP cue skeleton — **lobby loop** (lounge tabla-noir,
vinyl crackle), **question bed** (ticking tanpura tension), **timer panic**
layer (last 5s), **Khooni Kamra theme** (Ramsay-horror organ + Bollywood
strings), **death stinger** (thunderclap + temple bell), **finale chase**
(escalating dhol + synth, genuinely scary — TMP's finale music is famously
straight horror), **winner fanfare** (full filmi brass + dhol). SFX: diya
flicker, tube-light buzz, film-reel scratches, chai-glass clinks, applause.
All cues ship as OGG loops with defined loop points; ducking rules: VO ducks
music −12dB.

---

## 8. Technical implementation plan

### 8.1 Repository layout (pnpm monorepo)

```
/packages
  /shared        # protocol types, phase enums, content schemas (zod)
  /server        # Node 22 + TS: REST + ws hub, room FSM, game engine API,
                 #   khooni-sawaal game module, TTS runtime service, mod portal API
  /client        # React + Vite SPA: join / controller / host / mod routes,
                 #   per-phase controller widgets, host-screen scenes, audio player
  /audio-pipeline# build-time TTS generation, bake-off harness, asset manifest
/content         # questions.json, finale.json, prompts-*.json, vo-script.json,
                 #   validation + balance scripts (run in CI)
/assets          # art, fonts, music, generated VO (git-lfs if needed)
```

### 8.2 Room FSM (server)

Phases: `lobby → tutorial → question(n) → reveal(n) → [khooniKamra(game)] →
… → wheel? → finaleIntro → finaleTurn(m) → gameOver → postGame`, plus
orthogonal `paused` flag. Transition table lives in one file with exhaustive
switch (TS `never` checks). All timers server-side (`setTimeout` against
deadline, cleared on early all-answered). Game module interface:
`init(players, settings, contentBank) / onAction(playerId, action) /
onTimeout(phase) / getPublicState() / getPrivateState(playerId)` — the
platform layer knows nothing about trivia.

### 8.3 Review board & milestone gates (owner mandate, 2026-07-19 — non-negotiable)

Every milestone ends with a **three-reviewer gate** run by dedicated agents
whose job is to find problems, not to approve:

1. **QA Reviewer** — correctness audit: reads the diff and the spec (§3–§7),
   hunts for logic bugs, spec deviations, missing edge cases, and untested
   paths; runs the full test suite and tries to break the build.
2. **Security Reviewer** — audits for input validation, injection (all player
   text is untrusted and rendered on shared screens), WebSocket auth/role
   escalation (player→VIP/host/moderator), room-code guessing, DoS surfaces
   (message flooding, oversized payloads, stroke bombs), secret handling, and
   dependency risk.
3. **User Tester** — plays the product like a real party: drives the actual
   running server/clients end to end (join flows, phones, reconnects, weird
   names, impatient tapping), and reports anything confusing, broken, or
   off-vibe.

**Gate rules:**
- A milestone is **not cleared** until all three reviewers sign off.
- **Every finding gets fixed — no severity threshold, no deferrals** — and
  every fix lands with a test that would have caught it. Re-review after
  fixes until each reviewer's findings list is empty.
- Reports and sign-offs are committed under `/qa/M<n>/` (`qa-report.md`,
  `security-report.md`, `user-test-report.md`, `signoff.md`) so the audit
  trail lives in the repo.
- **Global Tester:** before *anything* is declared done (a milestone, or any
  "it works" claim to the owner), a dedicated Global Tester agent runs the
  entire test suite — unit + integration, covering every code path (statement
  coverage enforced in CI; every FSM transition, every scoring rule, every
  minigame, every reconnect point must have a test) — from a clean checkout.
  A red or skipped test blocks the claim.

### 8.4 Testing & quality bar

- Unit: FSM transitions, scoring math, finale movement/steal/darkness logic,
  content validators (the finale rules are the most bug-prone — exhaustive
  table tests against §3.6 numbers).
- Simulation: headless bot clients play 1,000 randomized full games in CI
  (assert: always terminates, exactly one winner, no orphan phases, reconnect
  at every phase restores a renderable view).
- E2E: Playwright — host screen + 3 phone-viewport controllers through a full
  game, including a mid-game reconnect and a VIP censor action.
- Manual playtest gates at M3, M5, M7 (below) with real phones.

### 8.5 Deployment

Single Docker image (server serves the built SPA statically); deploy to
**ap-south-1 (Mumbai)**; TLS via platform; WebSocket-aware host (Fly.io or
Railway or EC2+Caddy — OPEN, ops choice, does not affect code). Static assets
(VO/music/art) served via CDN path from the same origin. Env-flagged TTS keys.
No database v1; metrics = structured logs + a `/healthz`.

### 8.6 Milestones

| M | Deliverable | Definition of done |
|---|---|---|
| M0 | Scaffold | Monorepo, CI (typecheck, tests, content validators), deploy pipeline to a staging URL |
| M1 | Platform core | Create/join room, lobby with avatars + QR, VIP, reconnect, pause, settings shell — playable "hello room" on real phones |
| M2 | Trivia loop | 10-question game with placeholder content/art, scoring, ghosts, mercy rules, tutorial flow, subtitles |
| M3 | Khooni Kamra | All 8 minigames incl. drawing canvas + voting + VIP censor; wheel; **playtest gate #1** |
| M4 | Finale | Aakhri Darwaza complete with steal/darkness/barrier; simulation suite green |
| M5 | Content bank | 500 questions + all prompts/categories through the full §6.5 pipeline; **playtest gate #2** |
| M6 | Voice & audio | Bake-off decided; all ~900 lines + music/SFX generated and wired; runtime name TTS |
| M7 | Polish | Full art pass, moderation portal, audience mode, streamer mode, share cards, accessibility passes; **playtest gate #3** |
| M8 | Launch prep | Load test (200-room soak), device matrix (budget Android/iOS Safari), name/domain finalization, policy re-review |

Build order within any milestone: server logic → controller UI → host-screen
presentation → audio.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TTS Hinglish quality disappoints for a *character* voice | Bake-off before mass generation; filter/reverb treatment hides TTS artifacts; fallback plan: hire a VO artist for the fixed 900 lines and keep TTS only for names (pipeline already separates these) |
| Content offends despite policy | §6.4 written policy + mandatory review pass + family-friendly default ON + in-game VIP censor + moderator portal |
| iOS Safari WebSocket/audio quirks | Audio unlocked on first tap (standard), heartbeat + resume logic, device matrix in M8 |
| Finale rules subtly wrong (most complex system) | Rules pinned numerically in §3.6; exhaustive table tests; playtest gate dedicated to the finale |
| Legal proximity to Jackbox | No copied assets/names/text; original art, script, music; mechanics only. Product never markets itself with the Jackbox name (repo name is internal) |

## 10. Open items (tracked, non-blocking)

1. Final brand names + domain (D-check before M8; one-file rename).
2. ~~Hosting provider — ops decision at M0.~~ **Decided at M0:** containerized
   deploy (single Docker image, server serves the built SPA statically; image
   built and validated in CI). Target: any container host in ap-south-1 /
   Mumbai (Fly.io `bom` preferred). **Actually provisioning the staging URL
   requires owner-held credentials — OPEN for the owner**; the M0 DoD
   "staging URL" is amended to "deploy pipeline (image + CI build) ready,
   staging URL pending owner credentials."
3. TTS provider winner — decided by bake-off at M6 start (amendment recorded here).
4. Music: royalty-free stems vs commissioned score — decide by M6.

## 11. Amendments log

| Date | Amendment |
|---|---|
| 2026-07-19 | **§4.2 wire shapes (QA-M0-16):** client messages are `{seq, payload:{action,…}}`; ALL server messages are a typed union each carrying `seq` (monotonic per connection). Game-specific inputs travel as an opaque `{action:"game", payload}` envelope validated by the active game module, keeping the platform protocol game-agnostic. |
| 2026-07-19 | **§6.2 spelling items** carry a `vo` field like every other content type (schema enforced `vo === id + ".ogg"` for all banks). |
| 2026-07-19 | **§8.1 layout:** `/packages/audio-pipeline` and `/assets` are created when their milestone lands (M6); content validation scripts live as tests in `@tamasha/shared` and run in CI both via `pnpm test` and the dedicated `pnpm validate:content` step. |
| 2026-07-19 | **§8.6 M0 DoD:** "deploy pipeline to a staging URL" delivered as Docker image + CI build; staging URL blocked on owner credentials (see §10.2). |
| 2026-07-19 | **§6.2 serve-order decision (UT-M0-11):** answer options are displayed in stored order (TMP-style fixed positions); the bank enforces balance with over- AND under-representation bounds plus a file-order cycle check in `checkBankInvariants`. |
| 2026-07-19 | **§4.4 start-path decision (QA-M1-7):** v1 start is **always controller-only** (VIP-only). The `controllerOnlyStart` setting is therefore inert in v1 and retained only for forward-compat; there is no host-screen start button. |
| 2026-07-19 | **§4.4 skipTutorial setting (QA-M1-8):** the *setting* (auto-skip on start) is honored by the game engine when the real trivia engine lands in **M2**; the stub engine ignores it. The VIP `skipTutorial` *action* works today. |
| 2026-07-19 | **§5.1 avatar art (UT-M1-6):** podium avatars render as labeled cards in M1–M6; the doll-style character art + ghost variant is part of the **M7** full art pass. |
| 2026-07-19 | **§8.6 M1 fixes:** reconnection now supports name-based rejoin (cross-device / cleared storage), VIP reassignment on VIP-leave, host-absence teardown, host-token persistence across reloads. Abuse limits (per-IP room-create / lookup / join throttles, global room cap, per-IP socket cap, join-handshake timeout, timing-safe secret compares) added per SEC-M1-1..4. |
| 2026-07-19 | **§3.3 M2 end-state deferral (QA-M2-3/6):** in M2 the trivia loop always runs to the full question budget and then reaches `gameOver`. The §3.3 early transitions are **deferred**: budget exhausted with 2+ alive → **Maut Ka Chakra** wheel lands in **M3/M4**; one living player remaining → **Aakhri Darwaza** finale lands in **M4**. Until then a solo player (and a game attrited to one survivor) plays all 10 questions (§3.2 "fully playable solo"), and mercy guarantees ≥1 alive so `gameOver` always has a winner. |
| 2026-07-19 | **§3.3 M2 wrong-answer death:** in M2 a wrong-answering living player becomes a ghost **directly** at the reveal; the **Khooni Kamra** killing-floor minigames (§3.4) are inserted between wrong-answer and death in **M3**. |
| 2026-07-26 | **M3 delivered:** wrong answers sentence living players to the Khooni Kamra (reveal names the floor; deaths land at the kamra result); all 8 minigames incl. streamed drawing + voting + VIP censor; Maut Ka Chakra when the budget ends with 2+ alive. |
| 2026-07-26 | **§3.7 K8 stakes (QA-M3-5):** "forfeit round money" under universal loyalty = each floor player pays ₹500 (`DHOKHA_LOYALTY_FORFEIT`); a UNIQUE betrayer takes ₹1,000 (`DHOKHA_POT`); money floors at 0. |
| 2026-07-26 | **§3.4/§4.4 kamra timers (QA-M3-7):** kamra play/vote DOUBLE under extended AND no-timer modes (accessibility); intro/result presentation beats stay fixed; kamra never runs untimed so a race always resolves. |
| 2026-07-26 | **§3.4 voters (QA-M3-12):** ghosts vote in K5/K6 ("everyone else votes", §3.5); the ≥1-living-voter selection constraint still counts living voters only. Audience voting arrives with M7 audience mode. |
| 2026-07-26 | **§4.3 censor policy (SEC-M3-4/5, QA-M3-3):** VIP censor is vote-phase-only, never self, hides CONTENT only — the censored entry stays on the ballot as a blank votable card, remains death-eligible, and the no-votes fallback is random, never seat 0. |
| 2026-07-26 | **§3.4 memorize window (SEC-M3-3):** K2/K3 memorize is SERVER-enforced (`KAMRA_TIMERS.memorizeMs`): the pattern/cards leave private snapshots and recall input opens only after the window; K2/K3 score = hits − false picks (floor 0), K2 payout = ₹1,000 × NET pattern proportion — hits minus false picks, floored at 0 (QA-M3-1, tightened by QA-M4-1). |
| 2026-07-26 | **§3.4 K7 rig (QA-M3-2):** if nobody drew the poison (multi floor), it MOVES into a randomly chosen picked cup — deaths are always attributable to a pick; a solo dodger survives. |
| 2026-07-26 | **§4.4 profanity filter (QA-M3-6):** wired for K5 typed answers — strict rejects, lenient masks (`@tamasha/shared` wordlist), plus name-grade codepoint hygiene (`sanitizeFreeText`) on kmAnswer/kmSpell (SEC-M3-1/6). |
| 2026-07-26 | **§3.2 solo mercy (QA-M3-14):** a solo game keeps mercy on every wrong answer (unlosable solo) — deliberate deviation from TMP solo killing-floor, preserving "fully playable solo" as a demo mode. |
| 2026-07-26 | **§3.3 wheel (QA-M3-15):** Maut Ka Chakra has no spin cap — terminates with probability 1 (5:6 death odds/spin); timer-driven, no busy-loop hazard. |
| 2026-07-26 | **§4.3 pause display (QA-M3-10):** while paused the public snapshot reports `deadline: null` (frozen countdowns, no ticking lie) and controllers swap widgets for the pause banner; server-side freeze/restore unchanged. |
| 2026-07-26 | **M4 delivered:** Aakhri Darwaza wired — attrition to one living player starts it immediately; the wheel hands over to it; solo games race the darkness after the budget; audience races as one IP-deduped collective runner (SEC-M4-1). |
| 2026-07-26 | **§3.6 barrier interpretation (QA-M4-6, pinned):** the barrier gates only the CROSSING — an imperfect would-be crosser bounces to 1 space out; "perfect" means all assigned options judged correctly (2-for-2 for a multiplayer living runner, 3-for-3 for ghosts/solo, per §3.6's per-runner option counts). |
| 2026-07-26 | **§3.3 wheel spin order (UT-M3-3):** poorest surviving player spins first (the leaders earned their safety); odds (5 maut : 1 zindagi) are shown on the shared screen. |
| 2026-07-26 | **§5.1 K3 symbols (UT-M3-13):** taash symbols are kirpan/hockey/chappal/hathoda — chappal replaces belan (no rolling-pin emoji renders; 🥖 read as bread). |
| 2026-07-26 | **M5 delivered (§6.1 targets met):** 540 questions (105 adult-flagged), 63 worst prompts, 62 drawing prompts, 126 spelling words, 80 finale categories — all §6.4-policy-filtered, schema-validated, correct-index balanced (10–40%), per-item source notes. VO ids regenerate at M6. |
| 2026-07-26 | **§3.6 idle runners (UT-M4-2, pinned):** NO LOCK = NO MOVEMENT — an unlocked judgment scores zero (TMP behavior), deviating from a literal reading of "leaving a non-fit unselected" for un-submitted turns; idle phones can't creep, steal bodies, or break the barrier. |
| 2026-07-26 | **K1 operands (UT-M4-5):** Hisaab-Kitaab operands floor at 2 — no zero-sum free money. |
| 2026-07-26 | **M7 delivered:** moderation portal (/mod) with a §4.4 generated password shown only on the host screen; kick (in-game minimum guarded, kicked seats fully removed from the engine — QA-M7-2) and post-hoc censor; §3.8 stats screen; share card; synthesized-SFX audio layer; audience finale runner. |
| 2026-07-26 | **§4.2 moderator scope (QA-M7-3, pinned):** v1 moderation is POST-HOC censorship during vote/result (content is visible from vote-start until censored), not pre-approval hold-until-approved; pre-approval queues are future work. Moderator-only rooms are sweep-eligible and moderator sockets are bounded only by the per-IP cap (QA-M7-4, accepted).Kick is not a ban — a kicked player may rejoin like any newcomer (SEC-M7-2, Jackbox parity); kick never drops player count below the minimum in any phase; the mod password is 48-bit and rotates when moderation toggles off (SEC-M7-1/3). |

---

*Prepared 2026-07-19. Research basis: Jackbox product mechanics, TMP 1/2
rulesets and content file formats, Jackbox design/audio practice, and
Jackbox-clone architecture patterns (full source notes in research reports).*
