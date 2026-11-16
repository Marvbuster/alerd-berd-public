import { utcDateTime } from "@/i18n/locale";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";
import Link from "next/link";
import semver from "semver";
import { compareRuntime } from "@/lib/repository-logic";
import { latestOnLine, type RegistryRef } from "@/lib/version-watch-logic";

export interface RepositoryComparisonProps {
  snapshot: { commitSha: string; declaredVersion: string | null; lockedVersion: string | null; scannedAt: Date } | null;
  lastError: string | null;
  applicationMissing?: boolean;
  monitors: { id: string; name: string; enabled: boolean; intervalSec: number; runtime: { version: string; reportedAt: Date } | null }[];
  registry: RegistryRef | null;
  registryMeta: { npmFetchedAt: Date | null; lastError: string | null };
}

const date = (value: Date, _locale: string = "de") => _t(_locale, "RepositoryComparison.m017e94bafa", { value0: utcDateTime(value, _locale) });

export function RepositoryComparison({ snapshot, lastError, monitors, applicationMissing, registry, registryMeta }: RepositoryComparisonProps) {
  const _locale = _useLocale();
  // Include runtime versions: Git may already be updated while a deployment lags.
  const versions = [snapshot?.lockedVersion, ...monitors.map((m) => m.runtime?.version)]
    .filter((v): v is string => !!v && !!semver.valid(v) && !semver.prerelease(v));
  const lines = new Map<string, string[]>();
  for (const version of versions) {
    const line = `${semver.major(version)}.${semver.minor(version)}.x`;
    lines.set(line, [...(lines.get(line) ?? []), version]);
  }
  const stale = !registryMeta.npmFetchedAt || Date.now() - registryMeta.npmFetchedAt.getTime() > 24 * 60 * 60_000;
  return <div className="repository-comparison">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{_t(_locale, "RepositoryComparison.m30b7f8482c")}</span><span className="text-xs text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.m7999551aa2")}</span></div>
    {lastError && <p role="status" className="repository-warning mb-3">{_message(_locale, lastError)}{snapshot && _t(_locale, "RepositoryComparison.m95d1f147b2")}</p>}
    <dl className="repository-versions">
      <div><dt>{_t(_locale, "RepositoryComparison.m3c99f1f336")}</dt><dd>{snapshot?.declaredVersion ?? "—"}</dd></div>
      <div><dt>{_t(_locale, "RepositoryComparison.ma76cc9a94c")}</dt><dd className="text-[var(--cyan)]">{snapshot?.lockedVersion ?? "—"}</dd></div>
      <div><dt>{_t(_locale, "RepositoryComparison.m1093115897")}</dt><dd>{monitors.length ? monitors.map((m) => <div key={m.id}>{m.runtime?.version ?? "—"}{monitors.length > 1 && <Link className="block text-xs font-normal" href={`/monitors/${m.id}`}>{m.name} ↗</Link>}</div>) : "—"}</dd></div>
    </dl>
    <div className="space-y-2 py-4">
      {!monitors.length && <p className="text-sm text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.m0d78be74cb")}</p>}
      {monitors.map((monitor) => {
        const result = compareRuntime({ snapshot, lastError, applicationMissing, runtime: monitor.runtime, monitorEnabled: monitor.enabled, intervalSec: monitor.intervalSec });
        const text = result.level === "match" ? _t(_locale, "RepositoryComparison.m250fa2ae97") : result.level === "mismatch" ? _t(_locale, "RepositoryComparison.me922600ff0") : _t(_locale, "RepositoryComparison.m99badc0604");
        return <div key={monitor.id} className="text-sm">
          {monitors.length > 1 && <p className="mb-1 text-xs text-[var(--fg-dim)]">{monitor.name}</p>}
          <span className={`comparison-pill comparison-pill--${result.level}`}>{result.level === "match" && "✓ "}{text}</span>
          {result.level !== "match" && <p className="mt-2 text-xs leading-relaxed text-[var(--fg-dim)]">{_message(_locale, result.reason)}</p>}
        </div>;
      })}
    </div>
    <div className="repository-updates">
      <div className="mb-2 text-xs font-semibold text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.m756e779ab3")}</div>
      {!lines.size && <p className="text-xs text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.m5bbc8b6006")}</p>}
      {[...lines].map(([line, current]) => {
        const latest = registry ? latestOnLine(current[0], registry.versions) : null;
        const pending = latest && current.some((v) => semver.gt(latest, v));
        return <div key={line} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--fg-dim)]">{line}</span>
          {latest ? <span className={pending ? "text-[var(--amber)]" : ""}>{pending ? `${stale ? _t(_locale, "RepositoryComparison.m323ec326c7") : _t(_locale, "RepositoryComparison.ma7e3955009")}: ${latest}` : _t(_locale, "RepositoryComparison.m382fa8ac47", { value0: latest })}</span> : <span className="text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.m80b8208586")}</span>}
        </div>;
      })}
      <p className="mt-2 text-xs leading-relaxed text-[var(--fg-dim)]">{_t(_locale, "RepositoryComparison.mc182c64cf9")}{registryMeta.npmFetchedAt ? date(registryMeta.npmFetchedAt, _locale) : _t(_locale, "RepositoryComparison.mf2e8ffc48e")}{stale && _t(_locale, "RepositoryComparison.m01b323be51")}</p>
      {registryMeta.lastError && <p className="mt-2 text-xs text-[var(--amber)]">{_t(_locale, "RepositoryComparison.m0a2458582c")}{_message(_locale, registryMeta.lastError)}</p>}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-[var(--fg-dim)]">{snapshot ? <>{_t(_locale, "RepositoryComparison.m1a69e87b3d")}<span className="font-mono">{snapshot.commitSha.slice(0, 8)}</span> · {date(snapshot.scannedAt, _locale)}</> : _t(_locale, "RepositoryComparison.mcad2bed129")}</p>
  </div>;
}
