import { useEffect, useState } from "react";
import { BRANDING, type JoinMessage } from "@tamasha/shared";
import { useRoom } from "./net/useRoom.js";
import { JoinForm, type JoinSubmit } from "./screens/Join.js";
import { Controller } from "./screens/Controller.js";
import { Host } from "./screens/Host.js";
import { Moderator } from "./screens/Moderator.js";
import {
  clearHostSession,
  loadHostSession,
  loadLast,
  loadSession,
  saveHostSession,
  saveSession,
} from "./net/session.js";
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
  if (route === "mod") return <ModApp env={e} />;
  if (route === "host") return <HostApp env={e} />;
  return <PlayerApp env={e} />;
}

function codeFromSearch(search: string): string {
  const m = /[?&]code=([^&]+)/.exec(search);
  return m !== null ? decodeURIComponent(m[1]!).toUpperCase().slice(0, 4) : "";
}

/** Join form → controller. Looks up the room first (§4.2) so it can prompt for
 *  a password when required, and restores a saved session if one exists. */
function PlayerApp({ env }: { env: Env }) {
  const [join, setJoin] = useState<Omit<JoinMessage, "type"> | null>(null);
  const [askPassword, setAskPassword] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // One-tap rejoin (UT-M3-8): prefill the last room+name this device played
  // in; a URL ?code= always wins.
  const last = loadLast();
  const initialCode = codeFromSearch(env.search) || (last?.code ?? "");
  const initialName = last?.name ?? "";

  async function onSubmit(v: JoinSubmit) {
    setNotice(undefined);
    // Pre-flight lookup: detect nonexistent/passworded rooms before the socket.
    try {
      const res = await fetch(`${env.origin}/api/rooms/${v.code}`);
      // Rate-limited is NOT "room not found" — many phones share a venue IP
      // (UT-M3-11); tell the player to retry, not to re-scan the QR.
      if (res.status === 429) {
        setNotice("Thoda ruko — bahut log ek saath jud rahe hain. 10 second mein phir try karo.");
        return;
      }
      const look = (await res.json()) as {
        exists: boolean;
        passwordRequired: boolean;
      };
      if (!look.exists) {
        setNotice("Yeh room code nahi mila. Dobara check karo.");
        return;
      }
      if (look.passwordRequired && v.password === undefined) {
        setAskPassword(true);
        setNotice("Is room mein password lagega.");
        return;
      }
    } catch {
      // Lookup failed (offline?) — fall through and let the socket surface it.
    }
    const saved = loadSession(v.code);
    setJoin({
      code: v.code,
      intent: "play",
      name: v.name,
      ...(v.password !== undefined ? { password: v.password } : {}),
      ...(saved !== null ? { sessionToken: saved.sessionToken } : {}),
    });
  }

  if (join === null) {
    return (
      <JoinForm
        initialCode={initialCode}
        initialName={initialName}
        askPassword={askPassword}
        {...(notice !== undefined ? { notice } : {})}
        onSubmit={(v) => void onSubmit(v)}
      />
    );
  }
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

/** Moderation portal (M7, §4.2): join with the room code + password (when the
 *  room has one) and get kick + censor controls over live content. */
function ModApp({ env }: { env: Env }) {
  const [join, setJoin] = useState<Omit<JoinMessage, "type"> | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  if (join === null) {
    return (
      <main style={S.page}>
        <h1 style={S.h1}>{BRANDING.platformName} — Moderator</h1>
        <p style={{ maxWidth: "22rem", textAlign: "center" }}>
          Room ka code aur MODERATION password daalo — password host screen par dikhta hai
          (Moderation setting ON karo).
        </p>
        <input
          aria-label="Room code"
          style={{ ...S.field, textTransform: "uppercase" }}
          value={code}
          onChange={(ev) => setCode(ev.target.value.slice(0, 4))}
          placeholder="CODE"
          maxLength={4}
        />
        <input
          aria-label="Room password"
          type="password"
          style={{ ...S.field, marginTop: "0.75rem" }}
          value={password}
          onChange={(ev) => setPassword(ev.target.value.slice(0, 32))}
          placeholder="Password (agar hai)"
        />
        <button
          style={S.button}
          disabled={!/^[A-Za-z]{4}$/.test(code.trim())}
          onClick={() =>
            setJoin({
              code: code.trim().toUpperCase(),
              intent: "moderate",
              ...(password !== "" ? { password } : {}),
            })
          }
        >
          Portal kholo
        </button>
      </main>
    );
  }
  return <ConnectedModerator env={env} join={join} />;
}

function ConnectedModerator({ env, join }: { env: Env; join: Omit<JoinMessage, "type"> }) {
  const { state, sendAction } = useRoom(env.wsUrl, join);
  return <Moderator state={state} onAction={sendAction} />;
}

/** Restores or creates a room, then connects as the host screen. */
function HostApp({ env }: { env: Env }) {
  const [room, setRoom] = useState<{ code: string; hostToken: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    async function boot() {
      // Reload-safe: if we still hold a host session for a room the server
      // knows, reconnect to it instead of orphaning it (QA-M1-5).
      const saved = loadHostSession();
      if (saved !== null) {
        try {
          const look = (await (await fetch(`${env.origin}/api/rooms/${saved.code}`)).json()) as { exists: boolean };
          if (look.exists) {
            if (live) setRoom(saved);
            return;
          }
        } catch {
          /* fall through to create */
        }
        clearHostSession();
      }
      try {
        const res = await fetch(`${env.origin}/api/rooms`, { method: "POST" });
        if (!res.ok) throw new Error("create failed");
        const body = (await res.json()) as { code: string; hostToken: string };
        saveHostSession({ code: body.code, hostToken: body.hostToken });
        if (live) setRoom({ code: body.code, hostToken: body.hostToken });
      } catch {
        if (live) setFailed(true);
      }
    }
    void boot();
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
  const { state, sendAction } = useRoom(env.wsUrl, {
    code: room.code,
    intent: "hostScreen",
    sessionToken: room.hostToken,
  });
  return <Host state={state} origin={env.origin} onAction={sendAction} />;
}
