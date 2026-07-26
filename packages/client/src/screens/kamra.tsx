import { useEffect, useMemo, useRef, useState } from "react";
import {
  DRAW_PALETTE,
  KAMRA_TIMERS,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  type KamraPrivate,
  type KamraPublicPhase,
  type KamraVoteEntry,
  type PlayerPublic,
  type Stroke,
  type WheelPublic,
} from "@tamasha/shared";
import { S } from "../ui/styles.css.js";
import { COLORS } from "../ui/theme.js";
import { Countdown } from "../ui/Countdown.js";

// Taash Ke Patte symbols (§3.4 K3): kirpan, hockey stick, belan, hathoda.
const TAASH_SYMBOLS = ["🗡️", "🏑", "🥖", "🔨"] as const;

/** The memorize window (K2/K3) — server-enforced (SEC-M3-3); the client
 *  mirrors it for display only. */
const MEMORIZE_MS = KAMRA_TIMERS.memorizeMs;

// ---------------------------------------------------------------------------
// Shared-screen (host) scenes for the killing floor + wheel (§5.2).
// ---------------------------------------------------------------------------
export function HostKamraScene({
  pub,
  players,
  deadline,
  subtitles,
}: {
  pub: KamraPublicPhase;
  players: PlayerPublic[];
  deadline: number | null;
  subtitles: boolean;
}) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "koi";
  const Subtitle = ({ vo }: { vo: string }) =>
    subtitles ? (
      <p style={{ maxWidth: "40rem", textAlign: "center", opacity: 0.85, fontStyle: "italic" }}>“{vo}”</p>
    ) : null;

  if (pub.kind === "kamraIntro") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <p style={{ color: COLORS.blood, fontSize: "1.1rem", letterSpacing: "0.2em" }}>KHOONI KAMRA</p>
        <h2 style={{ fontSize: "2.25rem", color: COLORS.marigold, margin: "0.25rem 0" }}>{pub.title}</h2>
        <p style={{ maxWidth: "36rem", margin: "0.5rem auto", fontSize: "1.15rem" }}>{pub.rules}</p>
        <p style={{ color: COLORS.ghost }}>
          {pub.floor.map((f) => f.name).join(" · ")}
        </p>
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "kamraPlay") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <p style={{ opacity: 0.7 }}>
          Khooni Kamra <Countdown deadline={deadline} />
        </p>
        {pub.prompt !== null && (
          <h2 style={{ fontSize: "2rem", color: COLORS.marigold, margin: "0.5rem auto", maxWidth: "42rem" }}>
            {pub.prompt}
          </h2>
        )}
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {pub.floor.map((f) => (
            <div
              key={f.playerId}
              style={{
                padding: "0.5rem 0.9rem",
                borderRadius: "0.5rem",
                background: "rgba(255,255,255,0.06)",
                border: `2px solid ${f.done ? COLORS.marigold : "transparent"}`,
              }}
            >
              <div style={{ fontWeight: 700 }}>{f.name}</div>
              <div style={{ fontSize: "0.8rem", opacity: 0.75 }}>{f.done ? "🪔 lock ho gaya" : "khel raha hai…"}</div>
            </div>
          ))}
        </div>
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "kamraVote") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <h2 style={{ fontSize: "1.6rem", color: COLORS.marigold }}>
          Sabse ghatiya kaunsa? <Countdown deadline={deadline} />
        </h2>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {pub.entries.map((e) => (
            <div key={e.playerId} style={{ maxWidth: "16rem" }}>
              <VoteEntryView entry={e} />
              <p style={{ margin: "0.25rem 0 0" }}>
                {e.name}
                {e.votesAgainst > 0 && (
                  <span style={{ color: COLORS.blood }}>{` — ${e.votesAgainst} 👎`}</span>
                )}
              </p>
            </div>
          ))}
        </div>
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "kamraResult") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        {pub.deaths.length > 0 ? (
          <h2 style={{ fontSize: "2rem", color: COLORS.blood }}>
            {`💀 ${pub.deaths.map(nameOf).join(", ")}`}
          </h2>
        ) : (
          <h2 style={{ fontSize: "2rem", color: COLORS.marigold }}>Sab bach gaye!</h2>
        )}
        {pub.survivors.length > 0 && pub.deaths.length > 0 && (
          <p style={{ color: COLORS.ghost }}>{`bach gaye: ${pub.survivors.map(nameOf).join(", ")}`}</p>
        )}
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  // wheel
  return <HostWheelScene pub={pub} />;
}

function HostWheelScene({ pub }: { pub: WheelPublic }) {
  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <p style={{ color: COLORS.blood, fontSize: "1.1rem", letterSpacing: "0.2em" }}>MAUT KA CHAKRA</p>
      <h2 style={{ fontSize: "2rem", color: COLORS.marigold }}>{pub.spinnerName}</h2>
      <div
        aria-label="wheel"
        style={{
          fontSize: "4rem",
          margin: "0.5rem",
          display: "inline-block",
          animation: pub.outcome === null ? "spin 0.6s linear infinite" : undefined,
        }}
      >
        {pub.outcome === null ? "🎡" : pub.outcome === "death" ? "💀" : "🪔"}
      </div>
      {pub.outcome !== null && (
        <h3 style={{ color: pub.outcome === "death" ? COLORS.blood : COLORS.marigold, fontSize: "1.5rem" }}>
          {pub.outcome === "death" ? "Maut." : "Zindagi!"}
        </h3>
      )}
      <p style={{ maxWidth: "40rem", margin: "0.5rem auto", opacity: 0.85, fontStyle: "italic" }}>“{pub.vo}”</p>
    </div>
  );
}

/** A vote entry: either a text answer or a drawing (rendered as SVG). */
export function VoteEntryView({ entry }: { entry: KamraVoteEntry }) {
  if (entry.strokes !== null) {
    return <StrokesView strokes={entry.strokes} size="10rem" />;
  }
  return (
    <div
      style={{
        padding: "0.75rem",
        borderRadius: "0.5rem",
        background: COLORS.plaster,
        color: COLORS.ink,
        fontSize: "1.1rem",
        minHeight: "3rem",
      }}
    >
      {entry.text ?? "…"}
    </div>
  );
}

/** One stroke as SVG — single-point taps render as dots, not invisible
 *  zero-length polylines (QA-M3-4c). */
function StrokeShape({ s }: { s: Stroke }) {
  const colorHex = DRAW_PALETTE[s.color] ?? DRAW_PALETTE[0];
  if (s.points.length === 1) {
    const [x, y] = s.points[0]!;
    return <circle cx={x * 100} cy={y * 100} r={s.width / 2} fill={colorHex} />;
  }
  return (
    <polyline
      points={s.points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
      fill="none"
      stroke={colorHex}
      strokeWidth={s.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/** Renders normalized strokes (0..1 virtual canvas) at any size. */
export function StrokesView({ strokes, size }: { strokes: Stroke[]; size: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label="drawing"
      style={{ width: size, height: size, background: COLORS.plaster, borderRadius: "0.5rem" }}
    >
      {strokes.map((s, i) => (
        <StrokeShape key={i} s={s} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Phone controller widgets for the kamra phases (§5.3).
// ---------------------------------------------------------------------------
export function ControllerKamra({
  pub,
  kamra,
  youId,
  isVip,
  isAudience,
  alive,
  deadline,
  onAction,
}: {
  pub: KamraPublicPhase;
  kamra: KamraPrivate | null;
  youId: string | null;
  isVip: boolean;
  isAudience: boolean;
  alive: boolean;
  deadline: number | null;
  onAction: (p: unknown) => void;
}) {
  const game = (payload: unknown) => onAction({ action: "game", payload });

  if (pub.kind === "wheel") {
    const mySpin = youId !== null && pub.spinnerId === youId;
    return (
      <p style={{ textAlign: "center", fontSize: "1.1rem" }}>
        {mySpin ? "🎡 Aapki baari… Maut Ka Chakra ghoom raha hai." : "Screen dekho — chakra ghoom raha hai."}
      </p>
    );
  }

  const onFloor = kamra?.onFloor ?? false;

  if (pub.kind === "kamraIntro") {
    return (
      <p style={{ textAlign: "center", fontSize: "1.1rem" }}>
        {onFloor ? "😨 Aap Khooni Kamre mein ho. Taiyaar raho…" : "Koi Khooni Kamre mein gaya hai. Screen dekho."}
      </p>
    );
  }

  if (pub.kind === "kamraPlay") {
    if (!onFloor) {
      return <p style={{ textAlign: "center" }}>Floor par khel chal raha hai… screen dekho.</p>;
    }
    if (kamra?.done === true) {
      return <p style={{ textAlign: "center" }}>Lock ho gaya. Ab dua karo. 🙏</p>;
    }
    return (
      <>
        <p style={{ opacity: 0.7, textAlign: "center" }}>
          <Countdown deadline={deadline} />
        </p>
        <MinigameInput pub={pub} data={kamra?.data ?? null} game={game} />
      </>
    );
  }

  if (pub.kind === "kamraVote") {
    const canVote = !onFloor && !isAudience && alive;
    if (!canVote && !isVip) {
      return (
        <p style={{ textAlign: "center" }}>
          {onFloor ? "Aapki kismat ab doosron ke haath mein hai…" : "Vote chal raha hai. Screen dekho."}
        </p>
      );
    }
    return (
      <VotePanel
        entries={pub.entries}
        canVote={canVote}
        isVip={isVip}
        youId={youId}
        game={game}
      />
    );
  }

  // kamraResult
  const iDied = youId !== null && pub.deaths.includes(youId);
  const iSurvived = youId !== null && pub.survivors.includes(youId);
  return (
    <p style={{ textAlign: "center", fontSize: "1.25rem" }}>
      {iDied ? "💀 Aap mar gaye. Ab aatma ban ke khelo." : iSurvived ? "🪔 Bach gaye!" : "Faisla ho gaya. Screen dekho."}
    </p>
  );
}

/** Voting list; the VIP additionally gets a censor button per entry (§4.3). */
function VotePanel({
  entries,
  canVote,
  isVip,
  youId,
  game,
}: {
  entries: KamraVoteEntry[];
  canVote: boolean;
  isVip: boolean;
  youId: string | null;
  game: (p: unknown) => void;
}) {
  const [votedFor, setVotedFor] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: "0.75rem", width: "100%", maxWidth: "22rem" }}>
      <p style={{ textAlign: "center", margin: 0 }}>
        {canVote ? "Sabse GHATIYA ko vote do:" : "VIP: gandi cheez hatao."}
      </p>
      {entries.map((e) => {
        const mine = e.playerId === youId;
        return (
          <div key={e.playerId} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              type="button"
              disabled={!canVote || mine}
              onClick={() => {
                setVotedFor(e.playerId);
                game({ type: "kmVote", targetId: e.playerId });
              }}
              style={{
                ...S.button,
                marginTop: 0,
                flex: 1,
                background: votedFor === e.playerId ? COLORS.marigold : COLORS.blood,
                color: votedFor === e.playerId ? COLORS.ink : COLORS.cream,
                opacity: !canVote || mine ? 0.5 : 1,
              }}
            >
              {e.strokes !== null ? `🎨 ${e.name}` : `${e.name}: ${e.text ?? "…"}`}
            </button>
            {isVip && !mine && (
              // No self-censor — the server rejects it too (QA-M3-3).
              <button
                type="button"
                aria-label={`censor ${e.name}`}
                onClick={() => game({ type: "censor", targetId: e.playerId })}
                style={{ ...S.button, marginTop: 0, background: "transparent", border: `1px solid ${COLORS.blood}`, color: COLORS.blood, minWidth: "3rem" }}
              >
                🚫
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-minigame input widgets.
// ---------------------------------------------------------------------------
function MinigameInput({
  pub,
  data,
  game,
}: {
  pub: Extract<KamraPublicPhase, { kind: "kamraPlay" }>;
  data: unknown;
  game: (p: unknown) => void;
}) {
  switch (pub.minigame) {
    case "hisaabKitaab":
      return <MathPad data={data as { a: number; b: number; op: "+" | "-" } | null} game={game} />;
    case "yaaddasht":
      return <MemoryGrid data={data as { size: number; pattern: number[] } | null} game={game} />;
    case "taashKePatte":
      return <TaashRecall data={data as { cards: number[]; target: number } | null} game={game} />;
    case "spellingShelling":
      return <SpellPad word={pub.prompt ?? ""} game={game} />;
    case "sabseGhatiyaJawaab":
      return <WorstAnswer prompt={pub.prompt ?? ""} game={game} />;
    case "gandaChitra": {
      // Hydrate from the server-held draft so a reload doesn't desync the
      // visible canvas from the server strokes (QA-M3-4).
      const d = data as { strokes?: Stroke[] } | null;
      return <DrawingCanvas prompt={pub.prompt ?? ""} initialStrokes={d?.strokes ?? []} game={game} />;
    }
    case "zeharWaliChai":
      return <ChaiTray data={data as { cups: number; myPick: number | null } | null} game={game} />;
    case "dhokha":
      return <DhokhaChoice game={game} />;
  }
}

/** K1 — rapid mental math with a phone keypad. */
function MathPad({ data, game }: { data: { a: number; b: number; op: "+" | "-" } | null; game: (p: unknown) => void }) {
  const [entry, setEntry] = useState("");
  if (data === null) return <p>…</p>;
  // Real answers are −19..38; the schema caps at ±999 — limit typing to 3
  // digits (plus a sign) so the widget can't build a silently-rejected value
  // (QA-M3-13).
  const push = (d: string) =>
    setEntry((e) => {
      const digits = e.replace("-", "").length;
      return digits < 3 ? e + d : e;
    });
  const submit = () => {
    const v = Number(entry);
    if (!Number.isNaN(v) && entry !== "" && entry !== "-") {
      game({ type: "kmMath", value: v });
      setEntry("");
    }
  };
  return (
    <div style={{ width: "100%", maxWidth: "18rem", textAlign: "center" }}>
      <p style={{ fontSize: "2rem", margin: "0.25rem" }}>{`${data.a} ${data.op} ${data.b} = ?`}</p>
      <div
        aria-label="answer"
        style={{ minHeight: "2.5rem", fontSize: "1.75rem", background: COLORS.plaster, color: COLORS.ink, borderRadius: "0.5rem", marginBottom: "0.5rem" }}
      >
        {entry}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.4rem" }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "⌫"].map((k) => (
          <button
            key={k}
            type="button"
            style={{ ...S.button, marginTop: 0, padding: "0.6rem" }}
            onClick={() => {
              if (k === "⌫") setEntry((e) => e.slice(0, -1));
              else if (k === "-") setEntry((e) => (e === "" ? "-" : e));
              else push(k);
            }}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" style={{ ...S.button, width: "100%" }} onClick={submit}>
        Jawaab do
      </button>
    </div>
  );
}

/** K2 — memorize the burning tiles, then reproduce them. The pattern comes
 *  from the server ONLY during the memorize window (SEC-M3-3) — once it's
 *  null (e.g. after a reload) the grid goes straight to recall. */
function MemoryGrid({ data, game }: { data: { size: number; pattern: number[] | null } | null; game: (p: unknown) => void }) {
  const [timerDone, setTimerDone] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => setTimerDone(true), MEMORIZE_MS);
    return () => clearTimeout(t);
  }, []);
  if (data === null) return <p>…</p>;
  const showing = !timerDone && data.pattern !== null;
  const cols = Math.round(Math.sqrt(data.size));
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <div style={{ width: "100%", maxWidth: "18rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem" }}>{showing ? "YAAD KARO! 🔥" : "Ab wahi tiles dabao:"}</p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "0.35rem" }}>
        {Array.from({ length: data.size }, (_, i) => {
          const lit = showing && (data.pattern?.includes(i) ?? false);
          const picked = !showing && sel.has(i);
          return (
            <button
              key={i}
              type="button"
              aria-label={`tile ${i}`}
              disabled={showing}
              onClick={() => toggle(i)}
              style={{
                aspectRatio: "1",
                borderRadius: "0.4rem",
                border: "none",
                fontSize: "1.25rem",
                background: lit ? COLORS.marigold : picked ? COLORS.ghost : "rgba(255,255,255,0.12)",
                cursor: showing ? "default" : "pointer",
              }}
            >
              {lit ? "🔥" : picked ? "✓" : ""}
            </button>
          );
        })}
      </div>
      {!showing && (
        <button
          type="button"
          style={{ ...S.button, width: "100%" }}
          onClick={() => game({ type: "kmRecall", selection: [...sel] })}
        >
          Lock karo
        </button>
      )}
    </div>
  );
}

/** K3 — memorize the cards, then pick which positions held the target symbol.
 *  Cards come from the server ONLY during the memorize window (SEC-M3-3). */
function TaashRecall({ data, game }: { data: { cards: number[] | null; cardCount?: number; target: number } | null; game: (p: unknown) => void }) {
  const [timerDone, setTimerDone] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  useEffect(() => {
    const t = setTimeout(() => setTimerDone(true), MEMORIZE_MS);
    return () => clearTimeout(t);
  }, []);
  if (data === null) return <p>…</p>;
  const showing = !timerDone && data.cards !== null;
  const count = data.cards?.length ?? data.cardCount ?? 5;
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <div style={{ width: "100%", maxWidth: "20rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem" }}>
        {showing ? "Patte yaad karo!" : `Kahan tha ${TAASH_SYMBOLS[data.target] ?? "?"} ?`}
      </p>
      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "center" }}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`card ${i}`}
            disabled={showing}
            onClick={() => toggle(i)}
            style={{
              width: "3.2rem",
              height: "4.5rem",
              borderRadius: "0.4rem",
              border: `2px solid ${sel.has(i) ? COLORS.marigold : "transparent"}`,
              fontSize: "1.5rem",
              background: COLORS.plaster,
              color: COLORS.ink,
            }}
          >
            {showing ? TAASH_SYMBOLS[data.cards?.[i] ?? 0] : sel.has(i) ? "✓" : "🂠"}
          </button>
        ))}
      </div>
      {!showing && (
        <button
          type="button"
          style={{ ...S.button, width: "100%" }}
          onClick={() => game({ type: "kmRecall", selection: [...sel] })}
        >
          Lock karo
        </button>
      )}
    </div>
  );
}

/** Deterministic scramble so re-renders don't reshuffle the keys. */
export function scramble(word: string): string[] {
  const letters = word.split("");
  let seed = 0;
  for (const ch of word) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = letters[i]!;
    letters[i] = letters[j]!;
    letters[j] = tmp;
  }
  // Never present the word already solved (mirrors TMP's scrambled keys).
  if (letters.join("") === word && word.length > 1) {
    const tmp = letters[0]!;
    letters[0] = letters[1]!;
    letters[1] = tmp;
  }
  return letters;
}

/** K4 — spell the shown word from scrambled keys. */
function SpellPad({ word, game }: { word: string; game: (p: unknown) => void }) {
  const keys = useMemo(() => scramble(word), [word]);
  const [used, setUsed] = useState<number[]>([]); // indices into keys, in tap order
  const typed = used.map((i) => keys[i]).join("");
  return (
    <div style={{ width: "100%", maxWidth: "20rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem" }}>Screen par jo shabd hai, use spell karo:</p>
      <div
        aria-label="typed"
        style={{ minHeight: "2.2rem", fontSize: "1.5rem", letterSpacing: "0.15em", background: COLORS.plaster, color: COLORS.ink, borderRadius: "0.5rem", marginBottom: "0.5rem" }}
      >
        {typed}
      </div>
      <div style={{ display: "flex", gap: "0.35rem", justifyContent: "center", flexWrap: "wrap" }}>
        {keys.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={used.includes(i)}
            onClick={() => setUsed((u) => [...u, i])}
            style={{ ...S.button, marginTop: 0, minWidth: "2.6rem", padding: "0.5rem", opacity: used.includes(i) ? 0.35 : 1 }}
          >
            {k}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" style={{ ...S.button, flex: 1 }} onClick={() => setUsed((u) => u.slice(0, -1))}>
          ⌫
        </button>
        <button
          type="button"
          style={{ ...S.button, flex: 2 }}
          onClick={() => game({ type: "kmSpell", word: typed })}
        >
          Lock karo
        </button>
      </div>
    </div>
  );
}

/** K5 — worst answer: free text. */
function WorstAnswer({ prompt, game }: { prompt: string; game: (p: unknown) => void }) {
  const [text, setText] = useState("");
  return (
    <div style={{ width: "100%", maxWidth: "22rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem", fontSize: "1.1rem" }}>{prompt}</p>
      <textarea
        aria-label="jawaab"
        value={text}
        maxLength={140}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ width: "100%", fontSize: "1.1rem", borderRadius: "0.5rem", padding: "0.5rem", border: "none" }}
      />
      <button
        type="button"
        style={{ ...S.button, width: "100%" }}
        disabled={text.trim() === ""}
        onClick={() => game({ type: "kmAnswer", text: text.trim() })}
      >
        Bhejo
      </button>
    </div>
  );
}

/** K7 — pick a chai glass; one has "extra masala". */
function ChaiTray({ data, game }: { data: { cups: number; myPick: number | null } | null; game: (p: unknown) => void }) {
  if (data === null) return <p>…</p>;
  return (
    <div style={{ width: "100%", maxWidth: "20rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem" }}>Ek glass chuno. Sirf ek.</p>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
        {Array.from({ length: data.cups }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`chai ${i}`}
            onClick={() => game({ type: "kmPick", index: i })}
            style={{ ...S.button, marginTop: 0, fontSize: "2rem", padding: "0.5rem 0.75rem", background: "transparent", border: `2px solid ${COLORS.marigold}` }}
          >
            🍵
          </button>
        ))}
      </div>
    </div>
  );
}

/** K8 — Dhokha: spare them, or save yourself. */
function DhokhaChoice({ game }: { game: (p: unknown) => void }) {
  return (
    <div style={{ width: "100%", maxWidth: "20rem", display: "grid", gap: "0.75rem" }}>
      <p style={{ textAlign: "center", margin: 0 }}>Chupke se chuno. Koi nahi dekh raha… shayad.</p>
      <button
        type="button"
        style={{ ...S.button, background: "#1f7a3d", marginTop: 0 }}
        onClick={() => game({ type: "kmChoice", choice: "spare" })}
      >
        🤝 SPARE — sabko bachao
      </button>
      <button
        type="button"
        style={{ ...S.button, background: COLORS.blood, marginTop: 0 }}
        onClick={() => game({ type: "kmChoice", choice: "betray" })}
      >
        🐍 SAVE MYSELF — dhokha do
      </button>
    </div>
  );
}

/** K6 — the phone drawing canvas. Strokes stream one per message so each
 *  frame stays under the 4KB cap (SEC-M0-11); submit locks the drawing. */
export function DrawingCanvas({
  prompt,
  initialStrokes = [],
  game,
}: {
  prompt: string;
  /** Server-held draft, so a reload restores what was already drawn (QA-M3-4). */
  initialStrokes?: Stroke[];
  game: (p: unknown) => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes);
  const [color, setColor] = useState(1); // default: blood red
  const drawing = useRef<Stroke | null>(null);
  const [, force] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Points are quantized to 3 decimals so a full 120-point stroke frame stays
  // well under the 4KB pre-parse cap (SEC-M3-2: ~1.9KB worst case).
  const norm = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return null;
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    return [q((e.clientX - rect.left) / rect.width), q((e.clientY - rect.top) / rect.height)];
  };

  const start = (e: React.PointerEvent) => {
    if (strokes.length >= MAX_STROKES) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = norm(e);
    if (p === null) return;
    drawing.current = { color, width: 3, points: [p] };
    force((n) => n + 1);
  };
  const move = (e: React.PointerEvent) => {
    const s = drawing.current;
    if (s === null || s.points.length >= MAX_POINTS_PER_STROKE) return;
    const p = norm(e);
    if (p === null) return;
    s.points.push(p);
    force((n) => n + 1);
  };
  const end = () => {
    const s = drawing.current;
    if (s === null) return;
    drawing.current = null;
    setStrokes((prev) => [...prev, s]);
    game({ type: "drawStroke", stroke: s });
  };

  const live = drawing.current !== null ? [...strokes, drawing.current] : strokes;
  return (
    <div style={{ width: "100%", maxWidth: "20rem", textAlign: "center" }}>
      <p style={{ margin: "0.25rem", fontSize: "1.05rem" }}>{prompt}</p>
      <div
        ref={boxRef}
        data-testid="canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ touchAction: "none", width: "100%", aspectRatio: "1", background: COLORS.plaster, borderRadius: "0.5rem", position: "relative" }}
      >
        <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {live.map((s, i) => (
            <StrokeShape key={i} s={s} />
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "center", margin: "0.5rem 0" }}>
        {DRAW_PALETTE.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={`rang ${i}`}
            onClick={() => setColor(i)}
            style={{ width: "2.2rem", height: "2.2rem", borderRadius: "50%", background: c, border: color === i ? `3px solid ${COLORS.cream}` : "3px solid transparent", cursor: "pointer" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          style={{ ...S.button, flex: 1, marginTop: 0 }}
          onClick={() => {
            setStrokes((s) => s.slice(0, -1));
            game({ type: "drawUndo" });
          }}
        >
          Undo
        </button>
        <button
          type="button"
          style={{ ...S.button, flex: 1, marginTop: 0 }}
          onClick={() => {
            setStrokes([]);
            game({ type: "drawClear" });
          }}
        >
          Saaf karo
        </button>
        <button type="button" style={{ ...S.button, flex: 2, marginTop: 0 }} onClick={() => game({ type: "drawSubmit" })}>
          Ho gaya!
        </button>
      </div>
    </div>
  );
}
