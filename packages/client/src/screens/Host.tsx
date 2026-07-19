import { useEffect, useState } from "react";
import { BRANDING } from "@tamasha/shared";
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
          <p style={{ fontSize: "1.5rem", textAlign: "center" }}>
            {BRANDING.venueName} ke darwaze band ho chuke hain. Khel shuru!
          </p>
          <PodiumRow players={pub.players} audienceCount={pub.audienceCount} />
        </>
      )}
    </main>
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
