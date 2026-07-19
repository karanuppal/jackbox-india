import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  MAX_CLIENT_FRAME_BYTES,
  WS_MESSAGES_PER_SEC,
  wsClientMessageSchema,
  type JoinMessage,
  type Role,
  type ServerErrorCode,
  type ServerMessage,
  type WsClientMessage,
} from "@tamasha/shared";
import type { RoomRegistry } from "../rooms/registry.js";
import type { Room } from "../rooms/room.js";
import { normalizeCode } from "../rooms/roomCode.js";
import { RateLimiter } from "./rateLimiter.js";

interface Connection {
  ws: WebSocket;
  room: Room | null;
  playerId: string | null;
  role: Role | null;
  outSeq: number;
  lastInSeq: number;
  limiter: RateLimiter;
}

export interface HubOptions {
  now?: () => number;
  path?: string;
}

/**
 * WebSocket hub: binds connections to rooms/roles via a join handshake, routes
 * actions to the authoritative Room, and pushes tailored snapshots. Enforces
 * the frame cap (pre-parse) and per-connection rate limit.
 */
export class Hub {
  private wss: WebSocketServer;
  private registry: RoomRegistry;
  private connsByRoom = new Map<string, Set<Connection>>();
  private now: () => number;

  constructor(server: Server, registry: RoomRegistry, opts: HubOptions = {}) {
    this.registry = registry;
    this.now = opts.now ?? Date.now;
    this.wss = new WebSocketServer({ server, path: opts.path ?? "/play", maxPayload: MAX_CLIENT_FRAME_BYTES });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  close(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  private onConnection(ws: WebSocket): void {
    const conn: Connection = {
      ws,
      room: null,
      playerId: null,
      role: null,
      outSeq: 0,
      lastInSeq: -1,
      limiter: new RateLimiter(WS_MESSAGES_PER_SEC, this.now),
    };

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      // Frame cap enforced pre-parse (SEC-M0-11); ws also caps via maxPayload.
      if (isBinary || data.length > MAX_CLIENT_FRAME_BYTES) {
        this.sendError(conn, "BAD_MESSAGE", "invalid frame");
        return;
      }
      if (!conn.limiter.allow()) {
        this.sendError(conn, "RATE_LIMITED", "slow down");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString("utf8"));
      } catch {
        this.sendError(conn, "BAD_MESSAGE", "invalid json");
        return;
      }
      const msg = wsClientMessageSchema.safeParse(parsed);
      if (!msg.success) {
        this.sendError(conn, "BAD_MESSAGE", "invalid message");
        return;
      }
      this.handleMessage(conn, msg.data);
    });

    ws.on("close", () => this.onClose(conn));
    ws.on("error", () => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    });
  }

  private handleMessage(conn: Connection, msg: WsClientMessage): void {
    if (msg.type === "ping") {
      this.send(conn, { seq: conn.outSeq++, type: "pong" });
      return;
    }
    if (msg.type === "join") {
      if (conn.room !== null) {
        this.sendError(conn, "BAD_MESSAGE", "already joined");
        return;
      }
      this.handleJoin(conn, msg);
      return;
    }
    // action
    if (conn.room === null) {
      this.sendError(conn, "NOT_ALLOWED", "join first");
      return;
    }
    if (msg.seq <= conn.lastInSeq) return; // stale/replay — ignore (SEC-M0-12)
    conn.lastInSeq = msg.seq;
    const err = conn.room.applyAction(conn.playerId, msg.payload);
    if (err !== null) {
      this.sendError(conn, err, "action rejected");
      return;
    }
    this.broadcast(conn.room);
  }

  private handleJoin(conn: Connection, msg: JoinMessage): void {
    const room = this.registry.get(normalizeCode(msg.code));
    if (room === undefined) {
      this.sendError(conn, "ROOM_NOT_FOUND", "no such room");
      return;
    }
    const result =
      msg.intent === "hostScreen"
        ? room.connectHost(msg.sessionToken ?? "")
        : room.join({
            ...(msg.name !== undefined ? { name: msg.name } : {}),
            ...(msg.sessionToken !== undefined ? { sessionToken: msg.sessionToken } : {}),
            ...(msg.password !== undefined ? { password: msg.password } : {}),
          });
    if (!result.ok) {
      this.sendError(conn, result.code, "join rejected");
      return;
    }
    conn.room = room;
    conn.playerId = result.playerId;
    conn.role = result.role;
    this.addConn(room.code, conn);
    this.send(conn, {
      seq: conn.outSeq++,
      type: "joined",
      playerId: result.playerId ?? "",
      sessionToken: result.sessionToken,
      role: result.role,
    });
    this.broadcast(room);
  }

  private onClose(conn: Connection): void {
    if (conn.room === null) return;
    const room = conn.room;
    this.removeConn(room.code, conn);
    if (conn.role === "host") room.disconnectHost();
    else if (conn.playerId !== null) room.markDisconnected(conn.playerId);
    // Do NOT delete the room here: seats are held across disconnects so players
    // can reconnect (§4.2). The registry sweep reclaims rooms abandoned past
    // the grace window.
    this.broadcast(room);
  }

  private addConn(code: string, conn: Connection): void {
    let set = this.connsByRoom.get(code);
    if (set === undefined) {
      set = new Set();
      this.connsByRoom.set(code, set);
    }
    set.add(conn);
  }
  private removeConn(code: string, conn: Connection): void {
    const set = this.connsByRoom.get(code);
    if (set === undefined) return;
    set.delete(conn);
    if (set.size === 0) this.connsByRoom.delete(code);
  }

  /** Push a fresh tailored snapshot to every connection in the room. */
  broadcast(room: Room): void {
    const set = this.connsByRoom.get(room.code);
    if (set === undefined) return;
    const pub = room.publicState();
    for (const conn of set) {
      if (conn.role === null) continue;
      this.send(conn, {
        seq: conn.outSeq++,
        type: "state",
        public: pub,
        private: room.privateView(conn.playerId, conn.role),
      });
    }
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }
  private sendError(conn: Connection, code: ServerErrorCode, message: string): void {
    this.send(conn, { seq: conn.outSeq++, type: "error", code, message });
  }
}
