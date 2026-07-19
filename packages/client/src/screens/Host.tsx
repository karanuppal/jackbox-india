import { useEffect, useState } from "react";
import { BRANDING, type KsPublicPhase } from "@tamasha/shared";
import type { ClientState } from "../net/store.js";
import { S } from "../ui/styles.css.js";
import { COLORS, avatarLabel } from "../ui/theme.js";
import { joinUrl, qrSvg } from "../net/qr.js";

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
      <h1 style={S.h1}>{BRANDING.gameName}</h1>
      {pub.phase === "lobby" ? (
        <>
          <p style={{ opacity: 0.85 }}>jaao {origin.replace(/^https?:\/\//, "")} — code daalo:</p>
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
          <SettingsPanel settings={pub.settings} onAction={onAction} />
        </>
      ) : (
        <>
          {pub.paused && <p style={S.error}>⏸ Mishra Ji ne game rok diya hai…</p>}
          <GameScene pub={pub.phaseData as KsPublicPhase | null} subtitles={pub.settings.subtitles} />
          <PodiumRow players={pub.players} audienceCount={pub.audienceCount} />
        </>
      )}
    </main>
  );
}

/** The shared "show" for a game phase (§5.2). One dominant element per screen,
 *  sized for an across-the-room read; a subtitle line renders the host VO. */
function GameScene({ pub, subtitles }: { pub: KsPublicPhase | null; subtitles: boolean }) {
  if (pub === null) {
    return <p style={{ fontSize: "1.5rem", textAlign: "center" }}>{BRANDING.venueName}…</p>;
  }
  const Subtitle = ({ vo }: { vo: string }) =>
    subtitles ? <p style={{ maxWidth: "40rem", textAlign: "center", opacity: 0.85, fontStyle: "italic" }}>“{vo}”</p> : null;

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
        <p style={{ opacity: 0.7 }}>{`Sawaal ${pub.number} / ${pub.total}`}</p>
        <h2 style={{ fontSize: "2rem", maxWidth: "45rem", margin: "0.5rem auto" }}>{pub.text}</h2>
        <OptionGrid options={pub.options} />
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  if (pub.kind === "reveal") {
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <h2 style={{ fontSize: "1.75rem", maxWidth: "45rem", margin: "0.5rem auto" }}>{pub.text}</h2>
        <OptionGrid options={pub.options} correct={pub.correct} tally={pub.tally} />
        {pub.mercy ? (
          <p style={{ color: COLORS.marigold }}>Sab galat — par aaj sabko maafi!</p>
        ) : pub.allCorrect ? (
          <p style={{ color: COLORS.marigold }}>Sab ne sahi jawab diya!</p>
        ) : (
          <p style={{ color: COLORS.blood }}>{`${pub.deaths.length} mehmaan Khooni Kamra ki taraf…`}</p>
        )}
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  // gameOver
  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <h2 style={{ fontSize: "2rem", color: COLORS.marigold }}>Natija</h2>
      <ol style={{ listStyle: "none", padding: 0, maxWidth: "24rem", margin: "0 auto" }}>
        {pub.standings.map((s, i) => (
          <li
            key={s.playerId}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0.4rem 0.75rem",
              margin: "0.25rem 0",
              borderRadius: "0.5rem",
              background: i === 0 ? COLORS.marigold : "rgba(255,255,255,0.06)",
              color: i === 0 ? COLORS.ink : COLORS.cream,
              opacity: s.alive ? 1 : 0.6,
            }}
          >
            <span>{`${i === 0 ? "👑 " : ""}${s.alive ? "" : "👻 "}${s.name}`}</span>
            <span>{`₹${s.money}`}</span>
          </li>
        ))}
      </ol>
      <Subtitle vo={pub.vo} />
    </div>
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
        return (
          <div
            key={i}
            style={{
              padding: "0.75rem",
              borderRadius: "0.5rem",
              fontSize: "1.25rem",
              background: correct === undefined ? "rgba(255,255,255,0.06)" : isCorrect ? "#1f7a3d" : "rgba(192,24,43,0.25)",
              color: COLORS.cream,
              border: `2px solid ${isCorrect ? COLORS.marigold : "transparent"}`,
            }}
          >
            {opt}
            {count !== null && <span style={{ opacity: 0.7, fontSize: "0.9rem" }}>{` — ${count}`}</span>}
          </div>
        );
      })}
    </div>
  );
}

function PodiumRow({
  players,
  audienceCount,
}: {
  players: ClientState["public"] extends null ? never : NonNullable<ClientState["public"]>["players"];
  audienceCount: number;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
      {players.map((p) => (
        <div
          key={p.id}
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "0.5rem",
            background: p.connected ? COLORS.plaster : "#5a4a3a",
            color: COLORS.ink,
            opacity: p.connected ? 1 : 0.6,
            textAlign: "center",
            minWidth: "6rem",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {p.vip ? "★ " : ""}
            {p.name}
          </div>
          <div style={{ fontSize: "0.75rem" }}>{avatarLabel(p.avatar)}</div>
          {!p.connected && <div style={{ fontSize: "0.7rem", color: COLORS.blood }}>signal gaya</div>}
        </div>
      ))}
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
function SettingsPanel({ settings, onAction }: { settings: PublicSettings; onAction: ((p: unknown) => void) | undefined }) {
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
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center", marginTop: "1.25rem" }}>
      <Toggle label="Family-Friendly" on={settings.familyFriendly} patch={{ familyFriendly: !settings.familyFriendly }} />
      <Toggle label="Audience" on={settings.audienceEnabled} patch={{ audienceEnabled: !settings.audienceEnabled }} />
      <Toggle label="Extended timers" on={settings.timerMode === "extended"} patch={{ timerMode: settings.timerMode === "extended" ? "normal" : "extended" }} />
      <Toggle label="Streamer mode" on={settings.hideRoomCode} patch={{ hideRoomCode: !settings.hideRoomCode }} />
      {settings.passwordRequired && (
        <span style={{ fontSize: "0.8rem", alignSelf: "center", color: COLORS.ghost }}>🔒 Password lagega</span>
      )}
    </div>
  );
}
