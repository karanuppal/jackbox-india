import { COLORS } from "./theme.js";

// Inline style objects (no build-time CSS pipeline needed for M1). Kept in one
// place so the reviewer can see the whole surface. High-contrast, >=48px
// touch targets, portrait-friendly (§5.3).
export const S = {
  page: {
    minHeight: "100vh",
    margin: 0,
    background: COLORS.ink,
    color: COLORS.cream,
    fontFamily: "'Baloo 2', system-ui, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "1.25rem",
    boxSizing: "border-box" as const,
  },
  h1: { color: COLORS.marigold, fontSize: "2rem", margin: "0.5rem 0", textAlign: "center" as const },
  field: {
    fontSize: "1.5rem",
    padding: "0.75rem",
    width: "100%",
    maxWidth: "20rem",
    boxSizing: "border-box" as const,
    borderRadius: "0.5rem",
    border: `2px solid ${COLORS.marigold}`,
    background: COLORS.cream,
    color: COLORS.ink,
    textAlign: "center" as const,
    letterSpacing: "0.1em",
  },
  button: {
    fontSize: "1.25rem",
    fontWeight: 700,
    minHeight: "48px",
    padding: "0.75rem 1.5rem",
    borderRadius: "0.5rem",
    border: "none",
    background: COLORS.blood,
    color: COLORS.cream,
    cursor: "pointer",
    marginTop: "1rem",
  },
  code: {
    fontSize: "3.5rem",
    letterSpacing: "0.3em",
    color: COLORS.marigold,
    fontWeight: 800,
  },
  error: { color: COLORS.blood, marginTop: "0.75rem", minHeight: "1.2em" },
} as const;
