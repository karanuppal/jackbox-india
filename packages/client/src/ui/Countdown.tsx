import { useEffect, useState } from "react";
import { COLORS } from "./theme.js";

/**
 * Visible countdown against a server-sent deadline (UT-M2-3, §5.2 "burning
 * incense stick"). Renders remaining seconds; hidden when untimed (deadline
 * null). Client/server clock skew is a second or two — fine for a party game.
 */
export function Countdown({ deadline, now = () => Date.now() }: { deadline: number | null; now?: () => number }) {
  const [remaining, setRemaining] = useState(() => remainingSecs(deadline, now));

  useEffect(() => {
    if (deadline === null) return;
    setRemaining(remainingSecs(deadline, now));
    const id = setInterval(() => setRemaining(remainingSecs(deadline, now)), 250);
    return () => clearInterval(id);
  }, [deadline, now]);

  if (deadline === null) return null;
  const urgent = remaining <= 5;
  return (
    <div
      aria-label="Countdown"
      style={{
        display: "inline-block",
        minWidth: "3rem",
        fontWeight: 800,
        fontSize: "1.5rem",
        color: urgent ? COLORS.blood : COLORS.marigold,
        transition: "color 0.2s",
      }}
    >
      {`${remaining}s`}
    </div>
  );
}

export function remainingSecs(deadline: number | null, now: () => number): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - now()) / 1000));
}
