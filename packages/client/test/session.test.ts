import { describe, expect, it } from "vitest";
import { clearSession, loadSession, saveSession } from "../src/net/session.js";

function fakeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

describe("session persistence", () => {
  it("round-trips a session case-insensitively by code", () => {
    const store = fakeStore();
    saveSession({ code: "ACDE", name: "Karan", sessionToken: "tok-1" }, store);
    expect(loadSession("acde", store)?.sessionToken).toBe("tok-1");
    expect(loadSession("ACDE", store)?.name).toBe("Karan");
  });

  it("returns null for unknown or malformed entries", () => {
    const store = fakeStore();
    expect(loadSession("ZZZZ", store)).toBeNull();
    store.setItem("tamasha:session:BADD", "{not json");
    expect(loadSession("BADD", store)).toBeNull();
    store.setItem("tamasha:session:HALF", JSON.stringify({ code: "HALF" }));
    expect(loadSession("HALF", store)).toBeNull();
  });

  it("clears a session", () => {
    const store = fakeStore();
    saveSession({ code: "ACDE", name: "X", sessionToken: "t" }, store);
    clearSession("ACDE", store);
    expect(loadSession("ACDE", store)).toBeNull();
  });

  it("no-ops gracefully when storage is unavailable", () => {
    expect(() => saveSession({ code: "A", name: "n", sessionToken: "t" }, null)).not.toThrow();
    expect(loadSession("A", null)).toBeNull();
    expect(() => clearSession("A", null)).not.toThrow();
  });
});
