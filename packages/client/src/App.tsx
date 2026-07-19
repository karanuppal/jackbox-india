import { BRANDING } from "@tamasha/shared";

// Route shell (PLAN.md §4.1): "/" join page, "/host" host screen, "/mod"
// moderator portal. Real screens land in M1; this is the M0 scaffold.
export function App() {
  const path = typeof window === "undefined" ? "/" : window.location.pathname;
  if (path.startsWith("/host")) return <Placeholder title={`${BRANDING.gameName} — Host Screen`} />;
  if (path.startsWith("/mod")) return <Placeholder title={`${BRANDING.platformName} — Moderator`} />;
  return <Placeholder title={`${BRANDING.platformName} — Join`} />;
}

function Placeholder({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <p>Scaffold (M0). Ruko zara… sabar karo.</p>
    </main>
  );
}
