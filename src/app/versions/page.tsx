import { utcDateTime } from "@/i18n/locale";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { localizedTitle } from "@/i18n/data";
import { getLocale as _getLocale } from "next-intl/server";
import Link from "next/link";
import semver from "semver";
import { requireUser } from "@/lib/auth";
import { loadMonitorNodes } from "@/lib/monitor-view";
import { loadWatchContext } from "@/lib/version-watch";
import { WATCHED_PACKAGES, LEVEL_RANK, normalizeSeverity, advisoryLevel } from "@/lib/version-watch-logic";
import { type VizNode, type PackageWatch, WATCH_COLOR, localizedWATCH_LABEL as WATCH_LABEL } from "@/lib/viz";
import { PageHeader } from "@/components/PageHeader";

// Versionswächter-Übersicht: alle Spec-Health-Dienste nach live laufender
// Paket-Version (aktuell nur next), dazu der Stand des Referenzwissens.
export const dynamic = "force-dynamic";

function fmtDate(d: Date | null, _locale: string = "de"): string {
  return d ? utcDateTime(d, _locale) + _t(_locale, "versions.mde92d152d7") : _t(_locale, "versions.m2f3ec7cf77");
}

export default async function VersionsPage() {
  const _locale = await _getLocale();
  const user = await requireUser();
  const [nodes, ctx] = await Promise.all([loadMonitorNodes(user.id), loadWatchContext()]);
  const health = nodes.filter((n) => n.kind === "HEALTH");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-7">
      <PageHeader title={_t(_locale, "versions.med902d245f")} description={_t(_locale, "versions.m638f65a571")} icon="versions" />

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
              <span>{_t(_locale, "versions.mfcb45f8191")}{latest ?? "?"}</span>
              <span title={_t(_locale, "versions.ma69a77223c", { value0: fmtDate(meta.npmFetchedAt, _locale), value1: fmtDate(meta.advisoriesFetchedAt, _locale) })}>{_t(_locale, "versions.m439a44c894")}{fmtDate(meta.advisoriesFetchedAt, _locale)}</span>
              {meta.lastError && <span className="text-[var(--down)]">{_message(_locale, meta.lastError)}</span>}
            </div>

            {keys.length === 0 ? (
              <div className="panel px-4 py-6 text-center text-sm text-[var(--fg-dim)]">{_t(_locale, "versions.m335e95e7e8")}</div>
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
                        <span className="font-mono">{v || _t(_locale, "versions.m34eec17ffd")}</span>
                        <span className="text-[10px] font-medium" style={{ color }}>{WATCH_LABEL(_locale)[level]}</span>
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
                              {localizedTitle(f, _locale)}
                              {f.fixedIn ? _t(_locale, "versions.m8086b7d7f1", { value0: f.fixedIn }) : ""}
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
                      <span style={{ color: c }}>{a.severity}</span>{a.summary}<span className="text-[var(--fg-dim)]">{_t(_locale, "versions.mebb30d2b41")}{a.ranges.map((r) => r.vulnerable).join(" | ")}</span>
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <p className="text-xs text-[var(--fg-dim)]">{_t(_locale, "versions.mb0b02ddc55")}<code>{_t(_locale, "versions.m6d919a2fca")}</code> {_t(_locale, "versions.me477d1b9bb")}<Link href="/coolify">{_t(_locale, "versions.m1d5db57e2c")}</Link>.</p>
    </main>
  );
}
