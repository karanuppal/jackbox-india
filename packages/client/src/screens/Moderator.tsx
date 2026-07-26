import { BRANDING, type KsPublicPhase } from "@tamasha/shared";
import type { ClientState } from "../net/store.js";
import { S } from "../ui/styles.css.js";
import { COLORS } from "../ui/theme.js";
import { errorText } from "../net/errors.js";
import { VoteEntryView } from "./kamra.js";

/**
 * Moderation portal (M7, §4.2): live player roster with kick buttons, and —
 * during K5/K6 votes and results — every submission with a censor control.
 * Content the moderator censors turns into a blank card everywhere.
 */
export function Moderator({ state, onAction }: { state: ClientState; onAction: (p: unknown) => void }) {
  if (state.status === "error" && state.public === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>Portal band</h1>
        <p style={S.error}>
          {state.lastError !== null ? errorText(state.lastError.code) : "Kuch gadbad ho gayi."}
        </p>
        <p style={{ opacity: 0.7, maxWidth: "24rem", textAlign: "center" }}>
          Moderation setting ON hai? Password sahi hai?
        </p>
        <a href="/mod" style={{ color: COLORS.marigold }}>Dobara try karo</a>
      </main>
    );
  }
  if (state.public === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.platformName} — Moderator</h1>
        <p>Jud rahe hain…</p>
      </main>
    );
  }
  const pub = state.public;
  const pd = pub.phaseData as KsPublicPhase | null;
  const entries =
    pd !== null && (pd.kind === "kamraVote" || pd.kind === "kamraResult") ? pd.entries : [];

  return (
    <main style={{ ...S.page, justifyContent: "flex-start" }}>
      <h1 style={S.h1}>Moderator — {pub.code}</h1>
      <p style={{ opacity: 0.75 }}>{`Phase: ${pub.phase}${pub.paused ? " (paused)" : ""}`}</p>

      <h2 style={{ fontSize: "1.1rem", color: COLORS.marigold, margin: "0.75rem 0 0.25rem" }}>Khiladi</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
        {pub.players.map((p) => (
          <div key={p.id} style={{ padding: "0.4rem 0.6rem", borderRadius: "0.5rem", background: "rgba(255,255,255,0.07)", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span>{`${p.vip ? "★ " : ""}${p.alive ? "" : "👻 "}${p.name}`}</span>
            <button
              type="button"
              aria-label={`kick ${p.name}`}
              onClick={() => onAction({ action: "kick", playerId: p.id })}
              style={{ border: `1px solid ${COLORS.blood}`, background: "transparent", color: COLORS.blood, borderRadius: "0.4rem", cursor: "pointer", minHeight: "32px" }}
            >
              nikaalo
            </button>
          </div>
        ))}
        {pub.players.length === 0 && <p style={{ opacity: 0.6 }}>Koi khiladi nahi.</p>}
      </div>

      {entries.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.1rem", color: COLORS.marigold, margin: "1rem 0 0.25rem" }}>
            Submissions (censor = content chhupao)
          </h2>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
            {entries.map((e) => (
              <div key={e.playerId} style={{ maxWidth: "14rem", textAlign: "center" }}>
                <VoteEntryView entry={e} />
                <p style={{ margin: "0.2rem 0" }}>{e.name}</p>
                {!e.censored && (
                  <button
                    type="button"
                    aria-label={`censor ${e.name}`}
                    onClick={() => onAction({ action: "modCensor", targetId: e.playerId })}
                    style={{ ...S.button, marginTop: 0, background: "transparent", border: `1px solid ${COLORS.blood}`, color: COLORS.blood }}
                  >
                    🚫 censor
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {entries.length === 0 && (
        <p style={{ opacity: 0.6, marginTop: "1rem" }}>
          Jab K5/K6 submissions aayengi, yahan censor controls dikhenge.
        </p>
      )}
    </main>
  );
}
