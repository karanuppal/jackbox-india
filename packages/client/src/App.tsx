import { useEffect, useState } from "react";
import { BRANDING, type JoinMessage } from "@tamasha/shared";
import { useRoom } from "./net/useRoom.js";
import { JoinForm, type JoinSubmit } from "./screens/Join.js";
import { Controller } from "./screens/Controller.js";
import { Host } from "./screens/Host.js";
import { loadSession, saveSession } from "./net/session.js";
import { S } from "./ui/styles.css.js";

export type Route = "join" | "host" | "mod" | "notFound";

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

export interface Env {
  pathname: string;
  origin: string;
  wsUrl: string;
  search: string;
}

function browserEnv(): Env {
  const loc = window.location;
  const wsProto = loc.protocol === "https:" ? "wss:" : "ws:";
  return {
    pathname: loc.pathname,
    origin: loc.origin,
    wsUrl: `${wsProto}//${loc.host}/play`,
    search: loc.search,
  };
}

export function App({ env }: { env?: Env }) {
  const e = env ?? browserEnv();
  const route = resolveRoute(e.pathname);

  useEffect(() => {
    document.title = TITLES[route];
  }, [route]);

  if (route === "notFound") {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.platformName}</h1>
        <p>Yeh raasta {BRANDING.venueName} tak nahi jaata. Ghar wapas chalein?</p>
        <a href="/" style={{ color: "#f5a623" }}>Join page par chalo</a>
      </main>
    );
  }
  if (route === "mod") {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.platformName} — Moderator</h1>
        <p>Moderation portal M7 mein aayega.</p>
      </main>
    );
  }
  if (route === "host") return <HostApp env={e} />;
  return <PlayerApp env={e} />;
}

function codeFromSearch(search: string): string {
  const m = /[?&]code=([^&]+)/.exec(search);
  return m !== null ? decodeURIComponent(m[1]!).toUpperCase().slice(0, 4) : "";
}

/** Join form → controller. Restores a saved session if one exists. */
function PlayerApp({ env }: { env: Env }) {
  const [join, setJoin] = useState<Omit<JoinMessage, "type"> | null>(null);
  const initialCode = codeFromSearch(env.search);

  function onSubmit(v: JoinSubmit) {
    const saved = loadSession(v.code);
    setJoin({
      code: v.code,
      intent: "play",
      name: v.name,
      ...(saved !== null ? { sessionToken: saved.sessionToken } : {}),
    });
  }

  if (join === null) return <JoinForm initialCode={initialCode} onSubmit={onSubmit} />;
  return <ConnectedController env={env} join={join} />;
}

function ConnectedController({ env, join }: { env: Env; join: Omit<JoinMessage, "type"> }) {
  const { state, sendAction } = useRoom(env.wsUrl, join);
  useEffect(() => {
    if (state.sessionToken !== null && join.name !== undefined) {
      saveSession({ code: join.code, name: join.name, sessionToken: state.sessionToken });
    }
  }, [state.sessionToken, join.code, join.name]);
  return <Controller state={state} onAction={sendAction} />;
}

/** Creates a room via REST, then connects as the host screen. */
function HostApp({ env }: { env: Env }) {
  const [room, setRoom] = useState<{ code: string; hostToken: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${env.origin}/api/rooms`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("create failed"))))
      .then((body) => {
        if (live) setRoom({ code: body.code, hostToken: body.hostToken });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [env.origin]);

  if (failed) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.gameName}</h1>
        <p style={S.error}>Room nahi ban paya. Page refresh karo.</p>
      </main>
    );
  }
  if (room === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.gameName}</h1>
        <p>{BRANDING.venueName} taiyaar ho raha hai…</p>
      </main>
    );
  }
  return <ConnectedHost env={env} room={room} />;
}

function ConnectedHost({ env, room }: { env: Env; room: { code: string; hostToken: string } }) {
  const { state } = useRoom(env.wsUrl, {
    code: room.code,
    intent: "hostScreen",
    sessionToken: room.hostToken,
  });
  return <Host state={state} origin={env.origin} />;
}
