import { COLORS } from "./theme.js";

/** The Mishra Ji voiceover subtitle — the game's signature line. One styled
 *  band used identically on EVERY host scene (AES-LIVE-2): centered, sized for
 *  a couch read, staged like a quote instead of stray fine print. */
export function SubtitleBand({ vo, show }: { vo: string; show: boolean }) {
  if (!show) return null;
  return (
    <p
      style={{
        maxWidth: "46rem",
        margin: "1rem auto 0",
        textAlign: "center",
        fontStyle: "italic",
        fontSize: "1.3rem",
        lineHeight: 1.35,
        color: COLORS.cream,
        opacity: 0.92,
        textShadow: "0 1px 6px rgba(0,0,0,0.5)",
      }}
    >
      “{vo}”
    </p>
  );
}
