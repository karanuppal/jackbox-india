import type { ServerResponse } from "node:http";
import type { CreateRoomResponse, RoomLookupResponse } from "@tamasha/shared";
import type { RoomRegistry } from "./rooms/registry.js";
import { normalizeCode } from "./rooms/roomCode.js";
import type { IpRateLimiter } from "./net/ipLimits.js";

export interface ApiLimiters {
  create: IpRateLimiter;
  lookup: IpRateLimiter;
}

type Send = (res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) => void;

/**
 * REST surface (the ecast-style indirection, §4.2):
 *   POST /api/rooms        → create a room, returns code + host token
 *   GET  /api/rooms/:code  → lookup (existence, joinability, password/audience)
 * Per-IP rate limits guard both (SEC-M1-1/2). Returns true if handled here.
 */
export function handleApi(
  registry: RoomRegistry,
  method: string,
  pathname: string,
  res: ServerResponse,
  send: Send,
  wsPath: string,
  ip: string,
  limiters?: ApiLimiters,
): boolean {
  if (pathname === "/api/rooms") {
    if (method !== "POST") {
      send(res, 405, { error: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
      return true;
    }
    if (limiters !== undefined && !limiters.create.hit(ip)) {
      send(res, 429, { error: "RATE_LIMITED" }, { "retry-after": "60" });
      return true;
    }
    const room = registry.create();
    if (room === null) {
      send(res, 503, { error: "AT_CAPACITY" }, { "retry-after": "30" });
      return true;
    }
    const body: CreateRoomResponse = { code: room.code, hostToken: room.hostToken, wsPath };
    send(res, 201, body);
    return true;
  }

  const m = /^\/api\/rooms\/([^/]+)$/.exec(pathname);
  if (m !== null) {
    if (method !== "GET" && method !== "HEAD") {
      send(res, 405, { error: "METHOD_NOT_ALLOWED" }, { allow: "GET, HEAD" });
      return true;
    }
    if (limiters !== undefined && !limiters.lookup.hit(ip)) {
      send(res, 429, { error: "RATE_LIMITED" }, { "retry-after": "60" });
      return true;
    }
    const code = normalizeCode(decodeURIComponent(m[1]!));
    const room = registry.get(code);
    const body: RoomLookupResponse =
      room === undefined
        ? { exists: false, phase: null, joinable: false, passwordRequired: false, audienceEnabled: false }
        : {
            exists: true,
            phase: room.getPhase(),
            joinable: room.joinable(),
            passwordRequired: room.passwordRequired(),
            audienceEnabled: room.getSettings().audienceEnabled,
          };
    send(res, room === undefined ? 404 : 200, body);
    return true;
  }

  return false;
}
