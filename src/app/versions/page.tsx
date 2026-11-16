import Link from "next/link";
import semver from "semver";
import { requireUser } from "@/lib/auth";
import { loadMonitorNodes } from "@/lib/monitor-view";
import { loadWatchContext } from "@/lib/version-watch";
import { WATCHED_PACKAGES, LEVEL_RANK, normalizeSeverity, advisoryLevel } from "@/lib/version-watch-logic";
import { type VizNode, type PackageWatch, WATCH_COLOR, WATCH_LABEL } from "@/lib/viz";
import { PageHeader } from "@/components/PageHeader";

// Versionswächter-Übersicht: alle Spec-Health-Dienste nach live laufender
// Paket-Version (aktuell nur next), dazu der Stand des Referenzwissens.
export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "noch nie";
}

export default async function VersionsPage() {
  const user = await requireUser();
  const [nodes, ctx] = await Promise.all([loadMonitorNodes(user.id), loadWatchContext()]);
  const health = nodes.filter((n) => n.kind === "HEALTH");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7">
      <PageHeader title="Versionen" description="Welche Version live läuft und ob sie sicher ist." icon="versions" />

      {WATCHED_PACKAGES.map((name) => {
        const meta = ctx.registryMeta[name];
        const latest = ctx.registry[name]?.distTags.latest ?? null;

        // Gruppen: Version → Dienste; "keine Angabe" ans Ende, neueste oben.
        const groups = new Map<string, { pkg: PackageWatch; node: VizNode }[]>();
        for (const node of health) {
          const pkg = node.packages.find((p) => p.name === name);
          if (!pkg) continue;
          const key = pkg.version ?? "";
          groups.set(key, [...(groups.get(key) ?? []), { pkg, node }]);
        }
        const keys = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : semver.rcompare(a, b)));

        const active = ctx.advisories[name]
          .filter((a) => !a.withdrawnAt)
          .filter((a) => health.some((n) => n.packages.some((p) => p.name === name && p.findings.some((f) => f.ghsaId === a.ghsaId))));

        return (
          <section key={name} className="mb-8">
            <div className="versions-meta">
              <h2 className="font-mono">{name}</h2>
              <span>neueste {latest ?? "?"}</span>
              <span title={`npm ${fmtDate(meta.npmFetchedAt)} · Advisories ${fmtDate(meta.advisoriesFetchedAt)}`}>geprüft {fmtDate(meta.advisoriesFetchedAt)}</span>
              {meta.lastError && <span className="text-[var(--down)]">{meta.lastError}</span>}
            </div>

            {keys.length === 0 ? (
              <div className="panel px-4 py-6 text-center text-sm text-[var(--fg-dim)]">Noch kein Dienst meldet seine Version.</div>
            ) : (
              <div className="panel divide-y divide-[var(--fg-faint)]">
                {keys.map((v) => {
                  const rows = groups.get(v)!;
                  const level = rows[0].pkg.level; // gleiche Version → gleiche Bewertung
                  const color = WATCH_COLOR[level];
                  return (
                    <div key={v || "none"} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                      <div className="flex w-48 shrink-0 items-center gap-2.5">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                        <span className="font-mono">{v || "keine angabe"}</span>
                        <span className="text-[10px] font-medium" style={{ color }}>{WATCH_LABEL[level]}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          {rows.map(({ node }) => (
                            <Link key={node.id} href={`/monitors/${node.id}`} className="tag !text-[var(--fg)] hover:!text-[var(--cyan)]">
                              {node.label}
                            </Link>
                          ))}
                        </div>
                        {rows[0].pkg.findings
                          .filter((f) => LEVEL_RANK[f.level] >= LEVEL_RANK.orange)
                          .map((f, i) => (
                            <div key={i} className="mt-1.5 text-xs" style={{ color: WATCH_COLOR[f.level] }}>
                              › {f.ghsaId ? `${f.ghsaId} (${f.severity}): ` : ""}
                              {f.title}
                              {f.fixedIn ? ` · gefixt ab ${f.fixedIn}` : ""}
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {active.length > 0 && (
              <div className="mt-3 grid gap-1.5">
                {active.map((a) => {
                  const c = WATCH_COLOR[advisoryLevel(normalizeSeverity(a.severity))];
                  return (
                    <a key={a.ghsaId} href={a.url} target="_blank" rel="noreferrer" className="versions-advisory" style={{ borderColor: c }}>
                      <span style={{ color: c }}>{a.severity}</span>{a.summary}<span className="text-[var(--fg-dim)]">betroffen {a.ranges.map((r) => r.vulnerable).join(" | ")}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-xs text-[var(--fg-dim)]">Live aus <code>runtime.packages</code> der Spec-Health-Antwort, Advisories täglich aktualisiert. Git-Stand und Updates pro App stehen im <Link href="/coolify">App-Inventar</Link>.</p>
    </main>
  );
}
