import { useEffect } from "react";
import { BRANDING } from "@tamasha/shared";

// Route table (PLAN.md §4.1): "/" join page, "/host" host screen, "/mod"
// moderator portal. Exact match, case-insensitive, optional trailing slash;
// anything else gets a deliberate unknown-route screen (UT-M0-1/2/3).
type Route = "join" | "host" | "mod" | "notFound";

export function resolveRoute(pathname: string): Route {
  const p = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/") return "join";
  if (p === "/host") return "host";
  if (p === "/mod") return "mod";
  return "notFound";
}

const TITLES: Record<Route, string> = {
  join: `${BRANDING.platformName} — Join`,
  host: `${BRANDING.gameName} — Host Screen`,
  mod: `${BRANDING.platformName} — Moderator`,
  notFound: `${BRANDING.platformName}`,
};

export function App({ path }: { path?: string }) {
  const pathname = path ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  const route = resolveRoute(pathname);

  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);

  if (route === "notFound") {
    return (
      <main>
        <h1>{BRANDING.platformName}</h1>
        <p>Yeh raasta Manzil Mahal tak nahi jaata. Ghar wapas chalein?</p>
        <a href="/">Join page par chalo</a>
      </main>
    );
  }

  return (
    <main>
      <h1>{TITLES[route]}</h1>
      <p>Ruko zara… sabar karo.</p>
    </main>
  );
}
