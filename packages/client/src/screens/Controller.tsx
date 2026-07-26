import { useState } from "react";
import { BRANDING, type KsPrivatePhase, type KsPublicPhase } from "@tamasha/shared";
import type { ClientState } from "../net/store.js";
import { S } from "../ui/styles.css.js";
import { COLORS, avatarLabel } from "../ui/theme.js";
import { errorText } from "../net/errors.js";
import { Countdown } from "../ui/Countdown.js";
import { ControllerKamra } from "./kamra.js";

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
        <GamePhase
          pub={state.public.phaseData as KsPublicPhase | null}
          priv={state.private?.phaseData as KsPrivatePhase | null}
          deadline={state.public.deadline}
          isVip={isVip}
          isAudience={isAudience}
          youId={you?.id ?? null}
          onAction={onAction}
        />
      )}
      {softError !== null && phase === "lobby" && <p style={S.error}>{softError}</p>}
      {state.status === "reconnecting" && <p style={{ opacity: 0.7 }}>Dobara jud rahe hain…</p>}
    </main>
  );
}

/** Per-phase controller widgets for the trivia loop (§5.3). During a question
 *  the phone shows the four options as big buttons; after locking in, a wait
 *  card. Ghosts get the same controls, framed as playing from beyond. */
function GamePhase({
  pub,
  priv,
  deadline,
  isVip,
  isAudience,
  youId,
  onAction,
}: {
  pub: KsPublicPhase | null;
  priv: KsPrivatePhase | null;
  deadline: number | null;
  isVip: boolean;
  isAudience: boolean;
  youId: string | null;
  onAction: (p: unknown) => void;
}) {
  if (pub === null) return <p style={{ textAlign: "center" }}>Screen ki taraf dekho…</p>;
  const ghost = priv !== null && !priv.alive;

  if (
    pub.kind === "kamraIntro" ||
    pub.kind === "kamraPlay" ||
    pub.kind === "kamraVote" ||
    pub.kind === "kamraResult" ||
    pub.kind === "wheel"
  ) {
    return (
      <ControllerKamra
        pub={pub}
        kamra={priv?.kamra ?? null}
        youId={youId}
        isVip={isVip}
        isAudience={isAudience}
        alive={priv?.alive ?? true}
        deadline={deadline}
        onAction={onAction}
      />
    );
  }

  if (pub.kind === "tutorial") {
    return (
      <>
        <p style={{ textAlign: "center" }}>Mishra Ji samjha rahe hain… screen dekho.</p>
        {isVip && (
          <button style={S.button} onClick={() => onAction({ action: "skipTutorial" })}>
            Tutorial chhodo
          </button>
        )}
      </>
    );
  }
  if (pub.kind === "question") {
    // Audience answers are aggregate-only in v1 (§3.2); they watch the screen.
    if (isAudience) {
      return (
        <>
          <p style={{ opacity: 0.7 }}>{`Sawaal ${pub.number} / ${pub.total}`}</p>
          <p style={{ textAlign: "center" }}>Aap audience mein ho — screen par sawaal dekho!</p>
        </>
      );
    }
    const answered = priv?.answered ?? false;
    const mine = priv?.myAnswer ?? null;
    return (
      <>
        {ghost && <p style={{ color: COLORS.ghost }}>👻 Aatma mode — phir bhi khel sakte ho.</p>}
        <p style={{ opacity: 0.7 }}>
          {`Sawaal ${pub.number} / ${pub.total}`} <Countdown deadline={deadline} />
        </p>
        {answered ? (
          <p style={{ textAlign: "center" }}>Jawaab lock ho gaya. Screen dekho…</p>
        ) : (
          <div style={{ display: "grid", gap: "0.6rem", width: "100%", maxWidth: "22rem" }}>
            {pub.options.map((opt, i) => (
              <button
                key={i}
                style={{ ...S.button, marginTop: 0, background: mine === i ? COLORS.marigold : COLORS.blood, color: mine === i ? COLORS.ink : COLORS.cream }}
                onClick={() => onAction({ action: "game", payload: { type: "answer", questionId: pub.questionId, optionIndex: i } })}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </>
    );
  }
  if (pub.kind === "reveal") {
    return (
      <p style={{ textAlign: "center" }}>
        {pub.mercy
          ? "Sab bach gaye… is baar."
          : ghost
            ? "Aap ab aatma ho. Phir bhi khelte raho."
            : "Screen dekho — kiski kismat acchi thi?"}
      </p>
    );
  }
  // gameOver
  return (
    <>
      <p style={{ textAlign: "center" }}>Khel khatam. Screen par natija dekho!</p>
      {isVip && (
        <button style={S.button} onClick={() => onAction({ action: "restart" })}>
          Phir se khelein?
        </button>
      )}
    </>
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
