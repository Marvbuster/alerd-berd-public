import { describe, it, expect } from "vitest";
import { genInviteCode, inviteState } from "./invite";

describe("genInviteCode", () => {
  it("url-safe und ausreichend lang", () => {
    const c = genInviteCode();
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.length).toBeGreaterThanOrEqual(20);
  });

  it("unterschiedlich pro Aufruf", () => {
    expect(genInviteCode()).not.toBe(genInviteCode());
  });
});

describe("inviteState", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("ok, solange offen und nicht abgelaufen", () => {
    expect(inviteState({ usedAt: null, expiresAt: future })).toBe("ok");
  });

  it("used schlägt expired", () => {
    expect(inviteState({ usedAt: new Date(), expiresAt: past })).toBe("used");
  });

  it("expired, wenn abgelaufen und unbenutzt", () => {
    expect(inviteState({ usedAt: null, expiresAt: past })).toBe("expired");
  });

  it("Grenzfall: genau jetzt abgelaufen zählt als expired", () => {
    const now = new Date();
    expect(inviteState({ usedAt: null, expiresAt: now }, now)).toBe("expired");
  });
});
