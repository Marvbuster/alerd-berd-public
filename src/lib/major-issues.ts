// Offene Bug-Issues einer empfohlenen Major (src/data/recommended-majors.json).
// Reine Helfer, der Abruf steckt in version-watch.ts.
import semver from "semver";

export type MajorIssues = {
  major: number; repo: string; since: string; total: number; searchUrl: string; checkedAt: string;
  top: { title: string; url: string; reactions: number; createdAt: string }[];
};

// Erscheinen der Major: Release-Datum der ersten stabilen Version dieser Major.
export function majorReleaseDate(versions: Record<string, string>, major: number): string | null {
  const first = Object.keys(versions).filter((v) => semver.valid(v) && !semver.prerelease(v) && semver.major(v) === major).sort(semver.compare)[0];
  return first ? versions[first].slice(0, 10) : null;
}

export function issueSearchQuery(repo: string, filter: string, since: string): string {
  return `repo:${repo} is:issue is:open ${filter} created:>=${since}`.replace(/\s+/g, " ").trim();
}

export function issueSearchUrl(query: string): string {
  return `https://github.com/search?type=issues&s=reactions-%2B1&o=desc&q=${encodeURIComponent(query)}`;
}

type SearchResult = { total_count?: number; items?: { title?: string; html_url?: string; created_at?: string; reactions?: { total_count?: number } }[] };

export function parseIssueSearch(json: SearchResult, base: Omit<MajorIssues, "total" | "top">): MajorIssues {
  const top = (json.items ?? []).slice(0, 3).flatMap((i) => i.title && i.html_url ? [{
    title: i.title.slice(0, 160), url: i.html_url, reactions: i.reactions?.total_count ?? 0, createdAt: (i.created_at ?? "").slice(0, 10),
  }] : []);
  return { ...base, total: json.total_count ?? top.length, top };
}

export function majorIssuesLine(i: MajorIssues): string {
  if (!i.total) return `Keine offenen Bug-Issues seit ${i.major}.0 (${i.repo})`;
  const head = `${i.total} offene Bug-Issue${i.total === 1 ? "" : "s"} seit ${i.major}.0`;
  return i.top[0] ? `${head}, meistdiskutiert: ${i.top[0].title}` : head;
}
