import { useEffect, useRef, useState } from "react";
import { BRANDING, type KsPublicPhase, type PlayerPublic } from "@tamasha/shared";
import { cueForTransition, isMuted, play, setMuted, unlockAudio } from "../ui/audio.js";
import type { ClientState } from "../net/store.js";
import { S } from "../ui/styles.css.js";
import { COLORS, avatarLabel } from "../ui/theme.js";
import { joinUrl, qrSvg } from "../net/qr.js";
import { Countdown } from "../ui/Countdown.js";
import { SubtitleBand } from "../ui/Subtitle.js";
import { HostKamraScene } from "./kamra.js";
import { HostFinaleScene } from "./finale.js";

/**
 * Host screen (the shared "show" display). M1: lobby with room code, QR, the
 * filling avatar podium, and a settings summary. Scenes for the game phases
 * arrive with M2 (§5.2).
 */
export function Host({
  state,
  origin,
  onAction,
}: {
  state: ClientState;
  origin: string;
  onAction?: (p: unknown) => void;
}) {
  const code = state.public?.code ?? "";
  const [qr, setQr] = useState<string>("");
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    let live = true;
    if (code !== "") {
      qrSvg(joinUrl(origin, code)).then((svg) => {
        if (live) setQr(svg);
      });
    }
    return () => {
      live = false;
    };
  }, [code, origin]);

  // Audio (M6): unlock on the first host-screen interaction (autoplay policy)
  // and cue stings on phase transitions.
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("pointerdown", unlock);
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);
  const prevKind = useRef<string | null>(null);
  const pd = state.public?.phaseData as KsPublicPhase | null;
  useEffect(() => {
    const kind = pd?.kind ?? null;
    if (kind !== null && kind !== prevKind.current) {
      const deaths = pd !== null && "deaths" in pd ? pd.deaths.length : 0;
      const escaped = pd !== null && pd.kind === "gameOver" ? pd.finale?.escaped === true : false;
      const cue = cueForTransition(prevKind.current, kind, { deaths, escaped });
      if (cue !== null) play(cue);
    }
    prevKind.current = kind;
  }, [pd]);

  if (state.public === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.gameName}</h1>
        <p>{BRANDING.venueName} taiyaar ho raha hai…</p>
      </main>
    );
  }

  const pub = state.public;
  const hideCode = pub.settings.hideRoomCode;

  return (
    <main style={{ ...S.page, justifyContent: "flex-start" }}>
      <button
        type="button"
        aria-label="sound toggle"
        onClick={() => {
          const next = !muted;
          setMuted(next);
          setMutedState(next);
        }}
        style={{
          position: "absolute",
          top: "0.75rem",
          left: "0.75rem",
          fontSize: "1rem",
          minHeight: "40px",
          borderRadius: "1rem",
          padding: "0.3rem 0.7rem",
          border: `1px solid ${COLORS.marigold}`,
          background: "transparent",
          color: COLORS.cream,
          cursor: "pointer",
        }}
      >
        {muted ? "🔇" : "🔔"}
      </button>
      <h1 style={S.h1}>{BRANDING.gameName}</h1>
      {pub.phase === "lobby" ? (
        <>
          {/* the join URL is what a new player must read across the room —
              it must NOT be the smallest text on screen (AES-LIVE-5) */}
          <p style={{ fontSize: "1.4rem", margin: "0.25rem 0" }}>
            jaao <strong style={{ color: COLORS.marigold }}>{origin.replace(/^https?:\/\//, "")}</strong> — code daalo:
          </p>
          {!hideCode ? <div style={S.code}>{pub.code}</div> : <div style={S.code}>••••</div>}
          {!hideCode && qr !== "" && (
            <div
              aria-label="Join QR code"
              style={{ width: "10rem", height: "10rem", marginTop: "0.75rem" }}
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          )}
          <PodiumRow players={pub.players} audienceCount={pub.audienceCount} />
          {pub.players.length === 0 && <p style={{ opacity: 0.7 }}>Pehle mehmaan ka intezaar…</p>}
          <SettingsPanel
            settings={pub.settings}
            onAction={onAction}
            modPassword={state.private?.modPassword ?? null}
          />
        </>
      ) : (
        <>
          {pub.paused && <p style={S.error}>⏸ Mishra Ji ne game rok diya hai…</p>}
          {/* Host pause/resume control — resume was previously unreachable
              from any UI (UT-M3-1). Only the host connection can send these. */}
          {onAction !== undefined && pub.phase !== "gameOver" && (
            <button
              type="button"
              onClick={() => onAction({ action: pub.paused ? "resume" : "pause" })}
              style={{
                position: "absolute",
                top: "0.75rem",
                right: "0.75rem",
                fontSize: "0.85rem",
                minHeight: "40px",
                borderRadius: "1rem",
                padding: "0.3rem 0.9rem",
                border: `1px solid ${COLORS.marigold}`,
                background: "transparent",
                color: COLORS.cream,
                cursor: "pointer",
              }}
            >
              {pub.paused ? "▶ Resume" : "⏸ Pause"}
            </button>
          )}
          {/* the stage block is vertically centered so scenes fill the TV
              instead of top-loading with a dead bottom half (AES-LIVE-6) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", width: "100%" }}>
            <GameScene
              pub={pub.phaseData as KsPublicPhase | null}
              subtitles={pub.settings.subtitles}
              players={pub.players}
              deadline={pub.deadline}
            />
          </div>
          {/* the Natija scene carries its own podium — a duplicate card strip
              under it just repeats the same info (AES-LIVE-4) */}
          {(pub.phaseData as KsPublicPhase | null)?.kind !== "gameOver" && (
            <PodiumRow
              players={pub.players}
              audienceCount={pub.audienceCount}
              inGame
              showLocks={(pub.phaseData as KsPublicPhase | null)?.kind === "question"}
            />
          )}
        </>
      )}
      {/* haveli set-dressing: a faint diya row + warm floor glow so the stage
          reads staged, not unfinished (AES-LIVE-6) */}
      <div
        aria-hidden
        style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "18vh", pointerEvents: "none", background: "linear-gradient(transparent, rgba(192,24,43,0.12))" }}
      />
      <div
        aria-hidden
        style={{ position: "fixed", left: 0, right: 0, bottom: "0.3rem", textAlign: "center", pointerEvents: "none", opacity: 0.22, fontSize: "1.3rem", letterSpacing: "2.4rem" }}
      >
        🪔🪔🪔🪔🪔
      </div>
    </main>
  );
}

/** The shared "show" for a game phase (§5.2). One dominant element per screen,
 *  sized for an across-the-room read; a subtitle line renders the host VO. */
function GameScene({
  pub,
  subtitles,
  players,
  deadline,
}: {
  pub: KsPublicPhase | null;
  subtitles: boolean;
  players: PlayerPublic[];
  deadline: number | null;
}) {
  if (pub === null) {
    return <p style={{ fontSize: "1.5rem", textAlign: "center" }}>{BRANDING.venueName}…</p>;
  }
  const Subtitle = ({ vo }: { vo: string }) => <SubtitleBand vo={vo} show={subtitles} />;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "koi";

  if (pub.kind === "tutorial") {
    return (
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "1.75rem", color: COLORS.marigold }}>Kaise khelein</p>
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "question") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <p style={{ opacity: 0.7 }}>
          {`Sawaal ${pub.number} / ${pub.total}`} <Countdown deadline={deadline} />
        </p>
        <h2 style={{ fontSize: "2rem", maxWidth: "45rem", margin: "0.5rem auto" }}>{pub.text}</h2>
        <OptionGrid options={pub.options} />
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "reveal") {
    const floorNames = pub.floor.map(nameOf);
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <h2 style={{ fontSize: "1.75rem", maxWidth: "45rem", margin: "0.5rem auto" }}>{pub.text}</h2>
        <OptionGrid options={pub.options} correct={pub.correct} tally={pub.tally} />
        <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>(number = kitno ne yeh chuna)</p>
        {pub.mercy ? (
          <p style={{ color: COLORS.marigold }}>Sab galat — par aaj sabko maafi!</p>
        ) : pub.allCorrect ? (
          <p style={{ color: COLORS.marigold }}>Sab ne sahi jawab diya!</p>
        ) : (
          <p style={{ color: COLORS.blood, fontSize: "1.25rem" }}>
            {`🚪 ${floorNames.join(", ")} — Khooni Kamre ki taraf…`}
          </p>
        )}
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (
    pub.kind === "kamraIntro" ||
    pub.kind === "kamraPlay" ||
    pub.kind === "kamraVote" ||
    pub.kind === "kamraResult" ||
    pub.kind === "wheel"
  ) {
    return <HostKamraScene pub={pub} players={players} deadline={deadline} subtitles={subtitles} />;
  }
  if (pub.kind === "finaleIntro" || pub.kind === "finaleTurn") {
    return <HostFinaleScene pub={pub} deadline={deadline} subtitles={subtitles} />;
  }
  // gameOver — the winner is the HERO moment: giant name + amount, then the
  // rest of the field in a compact list (AES-LIVE-4).
  const champ = pub.standings.find((s) => s.playerId === pub.winnerId) ?? pub.standings[0];
  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: "2rem", color: COLORS.marigold, margin: "0.25rem 0" }}>Natija</h2>
      {/* the rule, spelled out — a poorer survivor beating richer ghosts must
          not read as a scoring bug (UT-M3-4) */}
      <p style={{ opacity: 0.8, margin: "0.2rem 0 0.5rem" }}>
        {pub.finale?.audienceEscaped === true
          ? "Audience bhaag gayi! Taaj zinda shareer ko mila."
          : pub.finale?.escaped === true
            ? "Aakhri Darwaze se zinda nikla — wahi jeeta. Paisa sirf yaadgaar hai."
            : pub.finale !== undefined
              ? "Koi zinda nahi nikla. Taaj sabse amir laash ko — mubarak ho… jaisi bhi ho." // UT-M4-3
              : "Niyam: jo zinda bacha, wahi jeeta — paisa nahi, saansein ginti hain."}
      </p>
      {champ !== undefined && (
        <div style={{ margin: "0.5rem 0 0.75rem" }}>
          <p style={{ fontSize: "3rem", fontWeight: 800, color: COLORS.marigold, margin: 0, lineHeight: 1.1 }}>
            {`👑 ${champ.alive ? "" : "👻 "}${champ.name}`}
          </p>
          <p style={{ fontSize: "1.6rem", margin: "0.15rem 0", opacity: 0.95 }}>{`₹${champ.money}`}</p>
        </div>
      )}
      <ol style={{ listStyle: "none", padding: 0, maxWidth: "24rem", margin: "0 auto" }}>
        {pub.standings
          .filter((s) => s.playerId !== champ?.playerId)
          .map((s) => (
            <li
              key={s.playerId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.4rem 0.75rem",
                margin: "0.25rem 0",
                borderRadius: "0.5rem",
                background: "rgba(255,255,255,0.06)",
                color: COLORS.cream,
                opacity: s.alive ? 1 : 0.6,
              }}
            >
              <span>{`${s.alive ? "" : "👻 "}${s.name}`}</span>
              <span>{`₹${s.money}`}</span>
            </li>
          ))}
      </ol>
      <GameOverStats standings={pub.standings} winnerId={pub.winnerId} />
      <ShareButton standings={pub.standings} winnerId={pub.winnerId} />
      <Subtitle vo={pub.vo} />
    </div>
  );
}

/** §3.8 stats screen: biggest fool, kamra survivor, richest ghost. Ties are
 *  named together (GF-LIVE-4), and a stat that just repeats the crowned
 *  winner is suppressed (GF-LIVE-6). */
function GameOverStats({ standings, winnerId = null }: { standings: { playerId: string; name: string; money: number; alive: boolean; wrongs: number; kamraEscapes: number }[]; winnerId?: string | null }) {
  if (standings.length === 0) return null;
  const fool = [...standings].sort((a, b) => b.wrongs - a.wrongs)[0];
  const fools = fool !== undefined ? standings.filter((s) => s.wrongs === fool.wrongs) : [];
  const survivor = [...standings].sort((a, b) => b.kamraEscapes - a.kamraEscapes)[0];
  const survivors = survivor !== undefined ? standings.filter((s) => s.kamraEscapes === survivor.kamraEscapes) : [];
  const ghosts = standings.filter((s) => !s.alive);
  const richGhost = [...ghosts].sort((a, b) => b.money - a.money)[0];
  const names = (list: { name: string }[]) => list.map((s) => s.name).join(" & ");
  const rows: [string, string][] = [];
  if (fool !== undefined && fool.wrongs > 0) rows.push(["🤡 Sabse bada bewakoof", `${names(fools)} (${fool.wrongs} galat)`]);
  if (survivor !== undefined && survivor.kamraEscapes > 0)
    rows.push(["🚪 Kamra survivor", `${names(survivors)} (${survivor.kamraEscapes} baar bacha)`]);
  if (richGhost !== undefined && richGhost.playerId !== winnerId)
    rows.push(["👻 Sabse amir aatma", `${richGhost.name} (₹${richGhost.money})`]);
  if (rows.length === 0) return null;
  return (
    <div style={{ maxWidth: "24rem", margin: "0.5rem auto" }}>
      {rows.map(([label, value]) => (
        <p key={label} style={{ margin: "0.2rem 0", opacity: 0.85 }}>
          <span style={{ color: COLORS.marigold }}>{label}:</span> {value}
        </p>
      ))}
    </div>
  );
}

/** Share card (M7): copies a text summary of the night to the clipboard. */
function ShareButton({ standings, winnerId }: { standings: { playerId: string; name: string; money: number; alive: boolean }[]; winnerId: string | null }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const winner = standings.find((s) => s.playerId === winnerId);
  const text = [
    `🩸 ${BRANDING.gameName} — aaj ki raat ${BRANDING.venueName} mein:`,
    ...standings.map(
      (s, i) => `${i + 1}. ${s.playerId === winnerId ? "👑 " : s.alive ? "" : "👻 "}${s.name} — ₹${s.money}`,
    ),
    winner !== undefined ? `${winner.name} zinda nikla. Baaki… mehmaan ban gaye.` : "Koi zinda nahi nikla.",
  ].join("\n");
  return (
    <button
      type="button"
      style={{ fontSize: "0.9rem", minHeight: "40px", borderRadius: "1rem", padding: "0.3rem 0.9rem", border: `1px solid ${COLORS.marigold}`, background: "transparent", color: COLORS.cream, cursor: "pointer", margin: "0.4rem" }}
      onClick={() => {
        // visible confirmation either way (UT-M5/M7-2)
        const p = navigator.clipboard?.writeText(text);
        if (p === undefined) {
          setCopied("failed");
          return;
        }
        p.then(() => setCopied("done")).catch(() => setCopied("failed"));
      }}
    >
      {copied === "done" ? "✓ copy ho gaya!" : copied === "failed" ? "✗ copy nahi hua" : "📋 Natija copy karo"}
    </button>
  );
}

function OptionGrid({
  options,
  correct,
  tally,
}: {
  options: readonly string[];
  correct?: number;
  tally?: { index: number; count: number; correct: boolean }[];
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", maxWidth: "40rem", margin: "0.75rem auto" }}>
      {options.map((opt, i) => {
        const isCorrect = correct === i;
        const count = tally?.find((t) => t.index === i)?.count ?? null;
        // Live question: bright plaster tiles — the answers are the second
        // most important thing on a trivia screen and must not read as
        // disabled placeholders from the couch (AES-LIVE-1).
        const idle = correct === undefined;
        return (
          <div
            key={i}
            style={{
              padding: "0.85rem",
              borderRadius: "0.5rem",
              fontSize: "1.5rem",
              fontWeight: 600,
              background: idle ? COLORS.plaster : isCorrect ? "#1f7a3d" : "rgba(192,24,43,0.25)",
              color: idle ? COLORS.ink : COLORS.cream,
              border: `2px solid ${isCorrect ? COLORS.marigold : idle ? "rgba(0,0,0,0.25)" : "transparent"}`,
            }}
          >
            {opt}
            {count !== null && (
              <span
                style={{
                  marginLeft: "0.5rem",
                  fontWeight: 800,
                  fontSize: "1.05rem",
                  background: "rgba(0,0,0,0.4)",
                  borderRadius: "1rem",
                  padding: "0.05rem 0.6rem",
                }}
              >
                {count}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PodiumRow({
  players,
  audienceCount,
  inGame = false,
  showLocks = false,
}: {
  players: PlayerPublic[];
  audienceCount: number;
  inGame?: boolean;
  showLocks?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
      {players.map((p) => {
        const ghost = inGame && !p.alive;
        return (
          <div
            key={p.id}
            style={{
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              background: ghost ? "#243a3a" : p.connected ? COLORS.plaster : "#5a4a3a",
              color: ghost ? COLORS.ghost : COLORS.ink,
              opacity: p.connected ? 1 : 0.6,
              textAlign: "center",
              minWidth: "6.5rem",
              border: showLocks && p.answered && p.alive ? `2px solid ${COLORS.marigold}` : "2px solid transparent",
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {`${p.vip ? "★ " : ""}${ghost ? "👻 " : ""}${p.name}`}
            </div>
            <div style={{ fontSize: "0.75rem" }}>{avatarLabel(p.avatar)}</div>
            {inGame && <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>{`₹${p.money}`}</div>}
            {showLocks && p.answered && p.alive && <div style={{ fontSize: "0.75rem" }}>🪔 taiyaar</div>}
            {!p.connected && <div style={{ fontSize: "0.7rem", color: COLORS.blood }}>signal gaya</div>}
          </div>
        );
      })}
      {audienceCount > 0 && (
        <div style={{ padding: "0.5rem 0.75rem", alignSelf: "center", color: COLORS.ghost }}>
          {`+ ${audienceCount} audience`}
        </div>
      )}
    </div>
  );
}

type PublicSettings = NonNullable<ClientState["public"]>["settings"];

/**
 * Host-screen settings (§4.4). Toggles dispatch `updateSettings` (host-only,
 * lobby-only). When `onAction` is absent (SSR/read-only preview) it renders as
 * a static summary. Timer mode and content filter are the M1 essentials.
 */
function SettingsPanel({
  settings,
  onAction,
  modPassword = null,
}: {
  settings: PublicSettings;
  onAction: ((p: unknown) => void) | undefined;
  /** §4.4: shown ONLY here — the /mod portal password (QA-M7-1). */
  modPassword?: string | null;
}) {
  const set = (patch: Record<string, unknown>) =>
    onAction?.({ action: "updateSettings", settings: patch });

  const Toggle = ({ label, on, patch }: { label: string; on: boolean; patch: Record<string, unknown> }) => (
    <button
      type="button"
      onClick={() => set(patch)}
      disabled={onAction === undefined}
      style={{
        fontSize: "0.85rem",
        minHeight: "40px",
        borderRadius: "1rem",
        padding: "0.3rem 0.8rem",
        border: `1px solid ${COLORS.marigold}`,
        background: on ? COLORS.marigold : "transparent",
        color: on ? COLORS.ink : COLORS.cream,
        cursor: onAction !== undefined ? "pointer" : "default",
      }}
    >
      {`${label}: ${on ? "ON" : "OFF"}`}
    </button>
  );

  return (
    // settings are back-of-house, not part of the show — keep the tray quiet
    // relative to the code/QR (AES-LIVE-8)
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "1.5rem", opacity: 0.85 }}>
      <Toggle label="Family-Friendly" on={settings.familyFriendly} patch={{ familyFriendly: !settings.familyFriendly }} />
      <Toggle label="Audience" on={settings.audienceEnabled} patch={{ audienceEnabled: !settings.audienceEnabled }} />
      <Toggle label="Lambe timers" on={settings.timerMode === "extended"} patch={{ timerMode: settings.timerMode === "extended" ? "normal" : "extended" }} />
      <Toggle label="Streamer mode" on={settings.hideRoomCode} patch={{ hideRoomCode: !settings.hideRoomCode }} />
      <Toggle label="Moderation" on={settings.moderation} patch={{ moderation: !settings.moderation }} />
      {settings.moderation && modPassword !== null && (
        <span
          style={{
            flexBasis: "100%",
            textAlign: "center",
            fontSize: "1.05rem",
            color: COLORS.marigold,
            background: "rgba(255,255,255,0.07)",
            borderRadius: "0.5rem",
            padding: "0.35rem",
          }}
        >
          {`🛡 /mod password: `}
          <strong style={{ letterSpacing: "0.12em" }}>{modPassword}</strong>
        </span>
      )}
      {settings.passwordRequired && (
        <span style={{ fontSize: "0.8rem", alignSelf: "center", color: COLORS.ghost }}>🔒 Password lagega</span>
      )}
    </div>
  );
}
