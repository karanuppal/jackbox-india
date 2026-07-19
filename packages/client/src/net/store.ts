import type { PrivateView, Role, RoomPublicState, ServerMessage } from "@tamasha/shared";

// Pure client-side view state derived from server messages. The React layer
// renders this; all game logic stays server-authoritative.

export type ConnStatus = "connecting" | "joined" | "reconnecting" | "error" | "closed";

export interface ClientState {
  status: ConnStatus;
  playerId: string | null;
  sessionToken: string | null;
  role: Role | null;
  public: RoomPublicState | null;
  private: PrivateView | null;
  lastError: { code: string; message: string } | null;
  /** Highest server seq applied; lets us drop out-of-order frames. */
  lastSeq: number;
}

export function initialState(): ClientState {
  return {
    status: "connecting",
    playerId: null,
    sessionToken: null,
    role: null,
    public: null,
    private: null,
    lastError: null,
    lastSeq: -1,
  };
}

export type StoreEvent =
  | { kind: "server"; message: ServerMessage }
  | { kind: "socketOpen" }
  | { kind: "socketClosed" }
  | { kind: "reconnecting" };

export function reduce(state: ClientState, event: StoreEvent): ClientState {
  switch (event.kind) {
    case "socketOpen":
      return { ...state, status: state.status === "reconnecting" ? "reconnecting" : "connecting" };
    case "reconnecting":
      return { ...state, status: "reconnecting" };
    case "socketClosed":
      return { ...state, status: state.status === "error" ? "error" : "closed" };
    case "server":
      return applyServer(state, event.message);
    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

function applyServer(state: ClientState, msg: ServerMessage): ClientState {
  // Drop stale/out-of-order frames (monotonic seq per connection).
  if (msg.seq <= state.lastSeq && msg.type !== "joined") return state;
  const base = { ...state, lastSeq: Math.max(state.lastSeq, msg.seq) };
  switch (msg.type) {
    case "joined":
      return {
        ...base,
        status: "joined",
        playerId: msg.playerId === "" ? null : msg.playerId,
        sessionToken: msg.sessionToken,
        role: msg.role,
        lastError: null,
      };
    case "state":
      return { ...base, status: "joined", public: msg.public, private: msg.private };
    case "error":
      return {
        ...base,
        status: base.public === null ? "error" : base.status,
        lastError: { code: msg.code, message: msg.message },
      };
    case "pong":
      return base;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
      return state;
    }
  }
}
