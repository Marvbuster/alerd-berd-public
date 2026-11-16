import { describe, expect, it } from "vitest";
import { issueSearchQuery, issueSearchUrl, majorIssuesLine, majorReleaseDate, parseIssueSearch } from "./major-issues";
import { knownIssuesFor } from "./dependency-target";

describe("Offene Issues einer Major", () => {
  it("nimmt das Datum der ersten stabilen Version der Major", () => {
    expect(majorReleaseDate({ "5.9.3": "2025-10-01T00:00:00Z", "7.0.1": "2026-08-20T00:00:00Z", "7.0.0": "2026-08-11T09:00:00Z" }, 7)).toBe("2026-08-11");
    expect(majorReleaseDate({ "5.9.3": "2025-10-01T00:00:00Z" }, 7)).toBeNull();
  });

  it("baut Suche und Link", () => {
    const q = issueSearchQuery("microsoft/TypeScript", "label:Bug", "2026-08-11");
    expect(q).toBe("repo:microsoft/TypeScript is:issue is:open label:Bug created:>=2026-08-11");
    expect(issueSearchUrl(q)).toContain("q=repo%3Amicrosoft%2FTypeScript");
  });

  it("liest die GitHub-Antwort und formuliert die Zeile", () => {
    const base = { major: 7, repo: "microsoft/TypeScript", since: "2026-08-11", searchUrl: "u", checkedAt: "c" };
    const parsed = parseIssueSearch({ total_count: 12, items: [{ title: "Crash bei X", html_url: "https://github.com/i/1", created_at: "2026-09-01T00:00:00Z", reactions: { total_count: 40 } }, { title: "ohne Link" }] }, base);
    expect(parsed.top).toEqual([{ title: "Crash bei X", url: "https://github.com/i/1", reactions: 40, createdAt: "2026-09-01" }]);
    expect(majorIssuesLine(parsed)).toBe("12 offene Bug-Issues seit 7.0, meistdiskutiert: Crash bei X");
    expect(majorIssuesLine(parseIssueSearch({ total_count: 0, items: [] }, base))).toBe("Keine offenen Bug-Issues seit 7.0 (microsoft/TypeScript)");
  });
});

describe("knownIssuesFor", () => {
  const issues = [
    { package: "next", range: ">=16.4.0 <17.0.0", kind: "build-trap", title: "Build prüft Tests", hint: "Vorher tsc", source: "https://example.org/a" },
    { package: "next", range: "<16.0.0", kind: "leak", title: "Alter Leak", source: "tech/nextjs" },
  ];
  it("trifft nur Einträge, deren Range die Zielversion enthält", () => {
    expect(knownIssuesFor("next", "16.4.6", issues)).toEqual([{ title: "Build prüft Tests. Vorher tsc", kind: "build-trap", url: "https://example.org/a" }]);
    expect(knownIssuesFor("next", "15.5.0", issues)).toEqual([{ title: "Alter Leak", kind: "leak" }]);
    expect(knownIssuesFor("zod", "4.6.7", issues)).toEqual([]);
  });
});
