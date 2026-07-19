import type { JoinMessage, ServerMessage, WsClientMessage } from "@tamasha/shared";
import { reduce, initialState, type ClientState, type StoreEvent } from "./store.js";

export interface ConnectionOptions {
  wsUrl: string;
  join: Omit<JoinMessage, "type">;
  onState: (state: ClientState) => void;
  /** Injectable for tests. */
  makeSocket?: (url: string) => WebSocketLike;
  now?: () => number;
  reconnectDelays?: number[];
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const DEFAULT_DELAYS = [500, 1000, 2000, 4000, 8000];

/**
 * Manages one room connection: opens the socket, sends the join handshake,
 * feeds server messages through the pure reducer, and auto-reconnects with
 * backoff (re-joining with the stored session token). Turn-based tolerance
 * means a few seconds of reconnect are invisible.
 */
export class RoomConnection {
  private opts: ConnectionOptions;
  private ws: WebSocketLike | null = null;
  private state: ClientState = initialState();
  private outSeq = 1;
  private closedByUs = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly delays: number[];
  private sessionToken: string | undefined;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    this.delays = opts.reconnectDelays ?? DEFAULT_DELAYS;
    this.sessionToken = opts.join.sessionToken;
  }

  getState(): ClientState {
    return this.state;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    const make = this.opts.makeSocket ?? defaultMakeSocket;
    const ws = make(this.opts.wsUrl);
    this.ws = ws;
    ws.onopen = () => {
      this.dispatch({ kind: this.attempt > 0 ? "reconnecting" : "socketOpen" });
      const join: WsClientMessage = {
        type: "join",
        ...this.opts.join,
        ...(this.sessionToken !== undefined ? { sessionToken: this.sessionToken } : {}),
      };
      ws.send(JSON.stringify(join));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "joined") this.sessionToken = msg.sessionToken;
      this.dispatch({ kind: "server", message: msg });
    };
    ws.onclose = () => {
      if (this.closedByUs) {
        this.dispatch({ kind: "socketClosed" });
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose will follow */
    };
  }

  private scheduleReconnect(): void {
    this.dispatch({ kind: "reconnecting" });
    const delay = this.delays[Math.min(this.attempt, this.delays.length - 1)]!;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  /** Send a platform/game action; assigns the monotonic seq. */
  sendAction(payload: WsClientMessage extends { type: "action" } ? never : unknown): void {
    if (this.ws === null) return;
    const msg: WsClientMessage = { type: "action", seq: this.outSeq++, payload: payload as never };
    this.ws.send(JSON.stringify(msg));
  }

  ping(): void {
    this.ws?.send(JSON.stringify({ type: "ping" } satisfies WsClientMessage));
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private dispatch(event: StoreEvent): void {
    this.state = reduce(this.state, event);
    if (event.kind === "server" && event.message.type === "joined") this.attempt = 0;
    this.opts.onState(this.state);
  }
}

function defaultMakeSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}
