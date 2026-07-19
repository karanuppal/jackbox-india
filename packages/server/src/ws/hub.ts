import type { Server, IncomingMessage } from "node:http";
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
import { ConcurrencyLimiter, IpRateLimiter } from "../net/ipLimits.js";

interface Connection {
  ws: WebSocket;
  ip: string;
  room: Room | null;
  playerId: string | null;
  role: Role | null;
  outSeq: number;
  lastInSeq: number;
  limiter: RateLimiter;
  joined: boolean;
  superseded: boolean; // an overlapping socket replaced this one; its close is a no-op
  joinTimer: ReturnType<typeof setTimeout> | null;
}

export interface HubOptions {
  now?: () => number;
  path?: string;
  /** Per-IP join-attempt limiter, shared with the REST lookup path (SEC-M1-2). */
  joinLimiter?: IpRateLimiter;
  /** Per-IP concurrent-connection cap (SEC-M1-3). */
  connLimiter?: ConcurrencyLimiter;
  /** Drop a socket that never completes `join` within this many ms (SEC-M1-3). */
  joinTimeoutMs?: number;
}

function clientIp(req: IncomingMessage): string {
  // Direct socket address only. A trusted-proxy XFF parse is a deploy-time
  // concern; never trust a client-supplied header here.
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * WebSocket hub: binds connections to rooms/roles via a join handshake, routes
 * actions to the authoritative Room, and pushes tailored snapshots. Enforces
 * the frame cap (pre-parse), per-connection rate limit, per-IP connection cap,
 * join-handshake timeout, and per-IP join throttle.
 */
export class Hub {
  private wss: WebSocketServer;
  private registry: RoomRegistry;
  private connsByRoom = new Map<string, Set<Connection>>();
  private roomTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private now: () => number;
  private joinLimiter: IpRateLimiter | null;
  private connLimiter: ConcurrencyLimiter | null;
  private joinTimeoutMs: number;

  constructor(server: Server, registry: RoomRegistry, opts: HubOptions = {}) {
    this.registry = registry;
    this.now = opts.now ?? Date.now;
    this.joinLimiter = opts.joinLimiter ?? null;
    this.connLimiter = opts.connLimiter ?? null;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? 10_000;
    this.wss = new WebSocketServer({ server, path: opts.path ?? "/play", maxPayload: MAX_CLIENT_FRAME_BYTES });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
  }

  close(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const ip = clientIp(req);
    if (this.connLimiter !== null && !this.connLimiter.acquire(ip)) {
      // Too many concurrent sockets from this IP (SEC-M1-3).
      try {
        ws.close(1013, "too many connections");
      } catch {
        ws.terminate();
      }
      return;
    }
    const conn: Connection = {
      ws,
      ip,
      room: null,
      playerId: null,
      role: null,
      outSeq: 0,
      lastInSeq: -1,
      limiter: new RateLimiter(WS_MESSAGES_PER_SEC, this.now),
      joined: false,
      superseded: false,
      joinTimer: null,
    };
    // Drop sockets that never complete the join handshake (SEC-M1-3).
    conn.joinTimer = setTimeout(() => {
      if (!conn.joined) {
        try {
          ws.close(1008, "join timeout");
        } catch {
          ws.terminate();
        }
      }
    }, this.joinTimeoutMs);
    if (typeof conn.joinTimer.unref === "function") conn.joinTimer.unref();

    ws.on("message", (data: Buffer, isBinary: boolean) => {
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
    // Per-IP join throttle (SEC-M1-2), shared with the REST lookup limiter.
    if (this.joinLimiter !== null && !this.joinLimiter.hit(conn.ip)) {
      this.sendError(conn, "RATE_LIMITED", "too many attempts");
      return;
    }
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
    conn.joined = true;
    if (conn.joinTimer !== null) clearTimeout(conn.joinTimer);
    // Evict any prior socket bound to the same identity (QA-M1-2): the newest
    // socket wins; the old one's close must not flip the live player offline.
    this.evictDuplicates(room.code, conn);
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

  private evictDuplicates(code: string, keep: Connection): void {
    const set = this.connsByRoom.get(code);
    if (set === undefined) return;
    for (const other of set) {
      if (other === keep) continue;
      const sameHost = keep.role === "host" && other.role === "host";
      const samePlayer = keep.playerId !== null && other.playerId === keep.playerId;
      if (sameHost || samePlayer) {
        other.superseded = true;
        this.removeConn(code, other);
        try {
          other.ws.close(1000, "replaced");
        } catch {
          other.ws.terminate();
        }
      }
    }
  }

  private onClose(conn: Connection): void {
    if (this.connLimiter !== null) this.connLimiter.release(conn.ip);
    if (conn.joinTimer !== null) clearTimeout(conn.joinTimer);
    if (conn.room === null || conn.superseded) return;
    const room = conn.room;
    this.removeConn(room.code, conn);
    if (conn.role === "host") room.disconnectHost();
    else if (conn.playerId !== null) room.markDisconnected(conn.playerId);
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

  broadcast(room: Room): void {
    const set = this.connsByRoom.get(room.code);
    if (set !== undefined) {
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
    this.scheduleTick(room);
  }

  /**
   * Schedule the engine's next timed auto-advance. When the room's deadline
   * passes, fire handleTimeout and re-broadcast (which reschedules the next
   * phase). One timer per room; rescheduled on every broadcast.
   */
  private scheduleTick(room: Room): void {
    const existing = this.roomTimers.get(room.code);
    if (existing !== undefined) {
      clearTimeout(existing);
      this.roomTimers.delete(room.code);
    }
    const deadline = room.getDeadline();
    if (deadline === null) return;
    const delay = Math.max(0, deadline - this.now());
    const timer = setTimeout(() => {
      this.roomTimers.delete(room.code);
      if (room.handleTimeout()) this.broadcast(room);
      else this.scheduleTick(room); // deadline moved (e.g. resumed) — reschedule
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    this.roomTimers.set(room.code, timer);
  }

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }
  private sendError(conn: Connection, code: ServerErrorCode, message: string): void {
    this.send(conn, { seq: conn.outSeq++, type: "error", code, message });
  }
}
