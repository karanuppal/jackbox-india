import { useEffect, useRef, useState } from "react";
import type { JoinMessage } from "@tamasha/shared";
import { RoomConnection } from "./connection.js";
import { initialState, type ClientState } from "./store.js";

export interface UseRoom {
  state: ClientState;
  sendAction: (payload: unknown) => void;
}

/** React binding for a RoomConnection. Opens on mount, closes on unmount. */
export function useRoom(wsUrl: string, join: Omit<JoinMessage, "type">): UseRoom {
  const [state, setState] = useState<ClientState>(initialState);
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    const conn = new RoomConnection({ wsUrl, join, onState: setState });
    connRef.current = conn;
    conn.connect();
    const ping = setInterval(() => conn.ping(), 20_000);
    return () => {
      clearInterval(ping);
      conn.close();
      connRef.current = null;
    };
    // Reconnect identity is stable for the room's lifetime; join is captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  return {
    state,
    sendAction: (payload: unknown) => connRef.current?.sendAction(payload as never),
  };
}
