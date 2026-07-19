import { useState } from "react";
import { BRANDING } from "@tamasha/shared";
import type { ClientState } from "../net/store.js";
import { S } from "../ui/styles.css.js";
import { avatarLabel } from "../ui/theme.js";
import { errorText } from "../net/errors.js";

/**
 * Phone controller. In M1 this shows the lobby "waiting" state and, for the
 * VIP, the start button. The per-phase widget vocabulary (§5.3) grows in M2.
 */
export function Controller({ state, onAction }: { state: ClientState; onAction: (p: unknown) => void }) {
  if (state.status === "error" && state.public === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>Arre!</h1>
        <p style={S.error}>{state.lastError !== null ? errorText(state.lastError.code) : "Kuch gadbad ho gayi."}</p>
        <a href="/" style={{ color: "#f5a623" }}>Wapas join karo</a>
      </main>
    );
  }
  if (state.public === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.platformName}</h1>
        <p>Ruko zara… sabar karo.</p>
      </main>
    );
  }

  const you = state.private?.you ?? null;
  const isVip = you?.vip ?? false;
  const phase = state.public.phase;
  const isAudience = (state.role ?? state.private?.role) === "audience";
  const softError = state.lastError !== null ? errorText(state.lastError.code) : null;

  return (
    <main style={S.page}>
      <h1 style={S.h1}>{you?.name ?? "Mehmaan"}</h1>
      {you !== null && <p style={{ opacity: 0.8 }}>{avatarLabel(you.avatar)}</p>}
      {state.public.paused && <p style={S.error}>Game rukka hua hai…</p>}
      {phase === "lobby" ? (
        <>
          <p style={{ textAlign: "center" }}>
            {isAudience
              ? "Aap audience mein ho. Screen dekhte raho!"
              : "Baaki khiladiyon ka intezaar hai…"}
          </p>
          {isVip && <VipCode code={state.public.code} hidden={state.public.settings.hideRoomCode} />}
          {isVip && (
            <button style={S.button} onClick={() => onAction({ action: "startGame" })}>
              Sab Aa Gaye!
            </button>
          )}
        </>
      ) : (
        <p style={{ textAlign: "center" }}>Screen ki taraf dekho — tamasha shuru!</p>
      )}
      {softError !== null && phase === "lobby" && <p style={S.error}>{softError}</p>}
      {state.status === "reconnecting" && <p style={{ opacity: 0.7 }}>Dobara jud rahe hain…</p>}
    </main>
  );
}

/** VIP-only room-code readout — lets the VIP announce/reveal the code even in
 *  streamer mode where the host screen masks it (§4.4, QA-M1-9). */
function VipCode({ code, hidden }: { code: string; hidden: boolean }) {
  const [revealed, setRevealed] = useState(!hidden);
  if (!hidden) {
    return <p style={{ opacity: 0.8 }}>Room code: <strong>{code}</strong></p>;
  }
  return revealed ? (
    <p style={{ opacity: 0.8 }}>Room code: <strong>{code}</strong></p>
  ) : (
    <button style={{ ...S.button, background: "transparent", border: "1px solid #f5a623" }} onClick={() => setRevealed(true)}>
      Room code dikhao
    </button>
  );
}
