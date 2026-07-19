import type { ServerResponse } from "node:http";
import type { CreateRoomResponse, RoomLookupResponse } from "@tamasha/shared";
import type { RoomRegistry } from "./rooms/registry.js";
import { normalizeCode } from "./rooms/roomCode.js";

/**
 * REST surface (the ecast-style indirection, §4.2):
 *   POST /api/rooms        → create a room, returns code + host token
 *   GET  /api/rooms/:code  → lookup (existence, joinability, password/audience)
 * Returns true if the request was handled here.
 */
export function handleApi(
  registry: RoomRegistry,
  method: string,
  pathname: string,
  res: ServerResponse,
  send: (res: ServerResponse, status: number, body: unknown, extra?: Record<string, string>) => void,
  wsPath: string,
): boolean {
  if (pathname === "/api/rooms") {
    if (method !== "POST") {
      send(res, 405, { error: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
      return true;
    }
    const room = registry.create();
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
