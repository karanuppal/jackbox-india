import { useEffect, useRef, useState } from "react";
import {
  AUDIENCE_RUNNER_ID,
  FINALE_DARKNESS_START,
  type FinalePrivate,
  type FinalePublic,
  type FinaleRunnerPublic,
} from "@tamasha/shared";
import { S } from "../ui/styles.css.js";
import { COLORS } from "../ui/theme.js";
import { Countdown } from "../ui/Countdown.js";
import { SubtitleBand } from "../ui/Subtitle.js";

// ---------------------------------------------------------------------------
// Shared-screen (host) scenes for the Aakhri Darwaza finale (§3.6/§5.2).
// ---------------------------------------------------------------------------
export function HostFinaleScene({
  pub,
  deadline,
  subtitles,
}: {
  pub: FinalePublic;
  deadline: number | null;
  subtitles: boolean;
}) {
  const Subtitle = ({ vo }: { vo: string }) => <SubtitleBand vo={vo} show={subtitles} />;

  if (pub.kind === "finaleIntro") {
    // Bridge line (GF-LIVE-2): when the finale arrives EARLY (last one
    // standing), the room was promised more sawaal — say why we're here.
    const living = pub.runners.filter((r) => r.kind === "living");
    return (
      <div style={{ textAlign: "center", width: "100%" }}>
        <p style={{ color: COLORS.blood, fontSize: "1.1rem", letterSpacing: "0.2em" }}>AAKHRI DARWAZA</p>
        <h2 style={{ fontSize: "2rem", color: COLORS.marigold }}>Subah se pehle bhaago!</h2>
        <p style={{ fontSize: "1.15rem", opacity: 0.9, margin: "0.2rem 0" }}>
          {living.length === 1
            ? `Sirf ${living[0]!.name} zinda bacha — ab aatmayein bhi peechhe bhaagengi!`
            : living.length === 0
              ? "Koi zinda nahi bacha — aatmaon ki race hogi!"
              : "Jo zinda darwaza paar kare, wahi jeetega. Aatmayein shareer chheen sakti hain!"}
        </p>
        <Track runners={pub.runners} darkness={FINALE_DARKNESS_START} />
        <Subtitle vo={pub.vo} />
      </div>
    );
  }
  const nameOf = (id: string) => pub.runners.find((r) => r.id === id)?.name ?? "koi";
  const darknessLive = pub.darkness < FINALE_DARKNESS_START;
  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <p style={{ opacity: 0.7 }}>
        {`Aakhri Darwaza — chakkar ${pub.turn}`} {pub.sub === "judge" && <Countdown deadline={deadline} />}
        {/* darkness telegraph so turn 4 isn't a surprise (UT-M4-4) */}
        <span style={{ marginLeft: "0.75rem", color: darknessLive ? COLORS.blood : COLORS.ghost, fontSize: "0.85rem" }}>
          {darknessLive ? "🌑 andhera badh raha hai!" : "🌑 andhera chakkar 4 se badhega"}
        </span>
      </p>
      <h2 style={{ fontSize: "1.6rem", color: COLORS.marigold, maxWidth: "42rem", margin: "0.4rem auto" }}>
        {pub.categoryTitle}
      </h2>
      <Track runners={pub.runners} darkness={pub.darkness} />
      {pub.sub === "judge" && (
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center", flexWrap: "wrap" }}>
          {pub.runners
            .filter((r) => !r.eliminated && r.distance > 0)
            .map((r) => (
              <span key={r.id} style={{ opacity: 0.8, fontSize: "0.9rem" }}>
                {r.locked ? `🪔 ${r.name}` : r.name}
              </span>
            ))}
        </div>
      )}
      {pub.sub === "resolve" && (
        <div style={{ maxWidth: "34rem", margin: "0.5rem auto" }}>
          {pub.events.map((e, i) => (
            <p key={i} style={{ margin: "0.2rem 0", color: e.type === "escape" ? COLORS.marigold : e.type === "steal" ? COLORS.ghost : COLORS.blood }}>
              {e.type === "escape" && `🚪 ${nameOf(e.id)} nikal gaya!`}
              {e.type === "steal" && `👤 ${nameOf(e.byId)} ne ${nameOf(e.fromId)} ka shareer chheen liya!`}
              {e.type === "darkness" && `🌑 Andhere ne ${nameOf(e.id)} ko nigal liya…`}
              {e.type === "barrier" && `🚧 ${nameOf(e.id)} darwaze par atak gaya — perfect chahiye!`}
            </p>
          ))}
          {pub.events.length === 0 && <p style={{ opacity: 0.7 }}>Sab bhaag rahe hain…</p>}
        </div>
      )}
      <Subtitle vo={pub.vo} />
    </div>
  );
}

/** The escape track: exit door on the left, darkness sweeping from the right. */
function Track({ runners, darkness }: { runners: FinaleRunnerPublic[]; darkness: number }) {
  const span = FINALE_DARKNESS_START; // fixed scale so movement reads across turns
  const pct = (d: number) => Math.min(100, Math.max(0, (d / span) * 100));
  return (
    // The finale is the climax — the track must read from the couch: taller
    // stage, bigger name chips, legible ticks (AES-LIVE-3).
    <div
      aria-label="escape track"
      style={{ position: "relative", height: "11rem", maxWidth: "50rem", margin: "0.75rem auto", background: "rgba(255,255,255,0.05)", borderRadius: "0.5rem", overflow: "hidden" }}
    >
      {/* darkness overlay from the far end */}
      <div
        style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(darkness)}%`, right: 0, background: "rgba(0,0,0,0.75)", borderLeft: `3px solid ${COLORS.blood}`, transition: "left 0.8s" }}
      />
      {/* distance ticks every 5 spaces so movement is legible (UT-M4-4) */}
      {[5, 10, 15, 20, 25].map((d) => (
        <div key={d} style={{ position: "absolute", left: `${pct(d)}%`, top: 0, bottom: 0, borderLeft: "1px dashed rgba(255,255,255,0.15)" }}>
          <span style={{ position: "absolute", bottom: "0.15rem", left: "0.2rem", fontSize: "0.85rem", opacity: 0.6 }}>{d}</span>
        </div>
      ))}
      <div style={{ position: "absolute", left: "0.4rem", top: "50%", transform: "translateY(-50%)", fontSize: "3.5rem" }}>🚪</div>
      {runners.map((r, i) => (
        <div
          key={r.id}
          style={{
            position: "absolute",
            left: `calc(${pct(r.distance)}% + 0.5rem)`,
            top: `${8 + (i % 4) * 22}%`,
            transition: "left 0.8s",
            opacity: r.eliminated ? 0.25 : 1,
            fontSize: "1.15rem",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "1.4rem" }}>{r.eliminated ? "🌑" : r.kind === "living" ? "🏃" : r.kind === "audience" ? "👥" : "👻"}</span>
          <span
            style={{
              marginLeft: "0.25rem",
              fontWeight: 700,
              color: r.kind === "living" ? COLORS.marigold : COLORS.ghost,
              background: "rgba(0,0,0,0.45)",
              borderRadius: "1rem",
              padding: "0.1rem 0.55rem",
            }}
          >
            {r.name}
            {r.lastMove > 0 && !r.eliminated ? ` +${r.lastMove}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phone controller for the finale (§5.3).
// ---------------------------------------------------------------------------
export function ControllerFinale({
  pub,
  priv,
  youId,
  isAudience,
  deadline,
  onAction,
}: {
  pub: FinalePublic;
  priv: FinalePrivate | null;
  youId: string | null;
  isAudience: boolean;
  deadline: number | null;
  onAction: (p: unknown) => void;
}) {
  if (pub.kind === "finaleIntro") {
    const me = pub.runners.find((r) => r.id === (isAudience ? AUDIENCE_RUNNER_ID : youId));
    return (
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "1.25rem" }}>🚪 Aakhri Darwaza!</p>
        <p>
          {me === undefined
            ? "Screen dekho — bhaagne ki race shuru ho rahi hai."
            : me.kind === "living"
              ? "Aap ZINDA ho. Darwaze tak sabse pehle pahuncho — aur zinda raho."
              : isAudience
                ? "Audience ek saath bhaagega — vote karke!"
                : "Aap aatma ho. Shareer chheeno ya andhere se pehle bhaago."}
        </p>
      </div>
    );
  }

  // Persistent role banner (GF-LIVE-1/3): outside the judge panel the phone
  // must still say WHO you are and what's at stake — a live runner's phone
  // must never look identical to a ghost's.
  const meNow = pub.runners.find((r) => r.id === (isAudience ? AUDIENCE_RUNNER_ID : youId));
  const RoleBanner = () =>
    meNow === undefined ? null : (
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <p style={{ margin: "0.1rem 0", fontSize: "1.05rem", color: meNow.kind === "living" ? COLORS.marigold : COLORS.ghost }}>
          {meNow.eliminated
            ? "🌑 Andhere ne nigal liya — ab sirf dekho."
            : meNow.kind === "living"
              ? "🏃 Aap ZINDA ho — bhaago!"
              : isAudience
                ? "👥 Audience ek saath bhaagti hai — vote karo!"
                : "👻 Aatma mode — shareer chheeno ya darwaza chhoo lo."}
        </p>
        {!meNow.eliminated && (
          <p style={{ margin: 0, opacity: 0.75, fontSize: "0.9rem" }}>
            {`Chakkar ${pub.turn} · darwaza ${meNow.distance} kadam door`}
          </p>
        )}
      </div>
    );

  if (pub.sub === "judge") {
    if (priv === null || !priv.racing || priv.options === null) {
      return (
        <div>
          <RoleBanner />
          <p style={{ textAlign: "center" }}>Race chal rahi hai… screen dekho.</p>
        </div>
      );
    }
    if (priv.locked && !isAudience) {
      return (
        <div>
          <RoleBanner />
          <p style={{ textAlign: "center" }}>Lock ho gaya. Bhaag… mat, ruko. 🏃</p>
        </div>
      );
    }
    return (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <RoleBanner />
        <JudgePanel
          key={pub.turn}
          turn={pub.turn}
          category={pub.categoryTitle}
          options={priv.options}
          deadline={deadline}
          onAction={onAction}
        />
      </div>
    );
  }

  // resolve — pick the most consequential event about me (escape > darkness >
  // steal > barrier), not merely the first in the list.
  const me = meNow;
  const mine = pub.events.filter((e) => (e.type === "steal" ? e.byId === me?.id || e.fromId === me?.id : e.id === me?.id));
  const order = { escape: 0, darkness: 1, steal: 2, barrier: 3 } as const;
  const myEvent = [...mine].sort((a, b) => order[a.type] - order[b.type])[0];
  return (
    <div>
      <RoleBanner />
      <p style={{ textAlign: "center", fontSize: "1.1rem" }}>
        {myEvent?.type === "escape"
          ? "🚪 NIKAL GAYE! Jeet gaye!"
          : myEvent?.type === "darkness"
            ? "🌑 Andhere ne pakad liya…"
            : myEvent?.type === "barrier"
              ? "🚧 Darwaza atka hai — agla chakkar PERFECT chahiye."
              : myEvent?.type === "steal" && myEvent.byId === me?.id
                ? "👤 Shareer aapka! Ab bhaago!"
                : myEvent?.type === "steal"
                  ? "👻 Shareer chhin gaya… wapas pack mein."
                  : me !== undefined && me.lastMove > 0
                    ? `+${me.lastMove} aage badhe!`
                    : "Screen dekho…"}
      </p>
    </div>
  );
}

/** Toggle-select every option you think fits, then lock (§3.6). */
function JudgePanel({
  turn,
  category,
  options,
  deadline,
  onAction,
}: {
  turn: number;
  category: string;
  options: { index: number; text: string }[];
  deadline: number | null;
  onAction: (p: unknown) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [locked, setLocked] = useState(false);
  // Regain-focus grace (FLEET: Chintu): a tap within 500ms of the tab
  // becoming visible again is swallowed — notification-return safety.
  const visibleAt = useRef(0);
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) visibleAt.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const toggle = (i: number) => {
    if (Date.now() - visibleAt.current < 500) return;
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };
  if (locked) return <p style={{ textAlign: "center" }}>Lock ho gaya. Screen dekho…</p>;
  return (
    <div style={{ width: "100%", maxWidth: "22rem", textAlign: "center" }}>
      <p style={{ opacity: 0.7, margin: "0.2rem" }}>
        <Countdown deadline={deadline} />
      </p>
      <p style={{ fontSize: "1.05rem", margin: "0.25rem" }}>{category}</p>
      <p style={{ opacity: 0.75, fontSize: "0.85rem", margin: "0.25rem" }}>Jo FIT ho use chuno — jo nahi, chhodo:</p>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {options.map((o) => (
          <button
            key={o.index}
            type="button"
            onClick={() => toggle(o.index)}
            style={{
              ...S.button,
              marginTop: 0,
              background: sel.has(o.index) ? COLORS.marigold : "rgba(255,255,255,0.1)",
              color: sel.has(o.index) ? COLORS.ink : COLORS.cream,
              border: `2px solid ${sel.has(o.index) ? COLORS.marigold : "rgba(255,255,255,0.3)"}`,
            }}
          >
            {sel.has(o.index) ? `✓ ${o.text}` : o.text}
          </button>
        ))}
      </div>
      <button
        type="button"
        style={{ ...S.button, width: "100%" }}
        onClick={() => {
          setLocked(true);
          onAction({ action: "game", payload: { type: "fjJudge", turn, selection: [...sel] } });
        }}
      >
        Lock karo
      </button>
    </div>
  );
}
