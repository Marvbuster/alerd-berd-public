import { describe, expect, it } from "vitest";
import { claudeExpiry, daysLeft, dueWarning, expiryPhrase, parseGitHubExpiration, soonest } from "./credential-expiry";

describe("parseGitHubExpiration", () => {
  it("liest UTC und Offsets aus dem GitHub-Header", () => {
    expect(parseGitHubExpiration("2027-01-14 12:00:00 UTC")?.toISOString()).toBe("2027-01-14T12:00:00.000Z");
    expect(parseGitHubExpiration("2026-12-14 09:48:00 -0800")?.toISOString()).toBe("2026-12-14T17:48:00.000Z");
    expect(parseGitHubExpiration("2026-12-14 09:48:00 +01:00")?.toISOString()).toBe("2026-12-14T08:48:00.000Z");
  });
  it("ohne Header oder Unsinn: kein Ablauf", () => {
    expect(parseGitHubExpiration(null)).toBeNull();
    expect(parseGitHubExpiration("")).toBeNull();
    expect(parseGitHubExpiration("nächsten Dienstag")).toBeNull();
  });
});

describe("daysLeft und claudeExpiry", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  it("rundet auf ganze Tage ab, negativ heißt abgelaufen", () => {
    expect(daysLeft(new Date("2026-12-14T12:00:00Z"), now)).toBe(30);
    expect(daysLeft(new Date("2026-11-15T11:00:00Z"), now)).toBe(0);
    expect(daysLeft(new Date("2026-11-14T11:00:00Z"), now)).toBe(-1);
  });
  it("Claude-Token gilt ein Jahr ab Verbindung", () => {
    expect(claudeExpiry(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("dueWarning", () => {
  it("meldet jede Stufe genau einmal, dringendste zuerst", () => {
    expect(dueWarning(45, null)).toBeNull();
    expect(dueWarning(30, null)).toBe(30);
    expect(dueWarning(20, 30)).toBeNull();
    expect(dueWarning(7, 30)).toBe(7);
    expect(dueWarning(1, 7)).toBe(1);
    expect(dueWarning(-3, 1)).toBe(0);
    expect(dueWarning(-3, 0)).toBeNull();
  });
  it("springt bei spät gespeicherten Tokens direkt auf die erreichte Stufe", () => {
    expect(dueWarning(5, null)).toBe(7);
    expect(dueWarning(-1, null)).toBe(0);
  });
});

describe("expiryPhrase und soonest", () => {
  it("formuliert den Abstand", () => {
    expect(expiryPhrase(12)).toBe("läuft in 12 Tagen ab");
    expect(expiryPhrase(1)).toBe("läuft morgen ab");
    expect(expiryPhrase(0)).toBe("läuft heute ab");
    expect(expiryPhrase(-2)).toBe("ist abgelaufen");
  });
  it("findet den Zugang, der zuerst abläuft", () => {
    const a = { label: "A", expiresAt: new Date("2027-03-01") }, b = { label: "B", expiresAt: new Date("2027-01-01") };
    expect(soonest([a, b])).toBe(b);
    expect(soonest([])).toBeNull();
  });
});
