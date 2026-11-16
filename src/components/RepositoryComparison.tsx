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

const date = (value: Date) => `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function RepositoryComparison({ snapshot, lastError, monitors, applicationMissing, registry, registryMeta }: RepositoryComparisonProps) {
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
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Next.js</span><span className="text-xs text-[var(--fg-dim)]">Git → Live</span></div>
    {lastError && <p role="status" className="repository-warning mb-3">{lastError}{snapshot && " · Git zeigt den letzten erfolgreichen Stand."}</p>}
    <dl className="repository-versions">
      <div><dt>Manifest</dt><dd>{snapshot?.declaredVersion ?? "—"}</dd></div>
      <div><dt>Lockfile</dt><dd className="text-[var(--cyan)]">{snapshot?.lockedVersion ?? "—"}</dd></div>
      <div><dt>Runtime</dt><dd>{monitors.length ? monitors.map((m) => <div key={m.id}>{m.runtime?.version ?? "—"}{monitors.length > 1 && <Link className="block text-xs font-normal" href={`/monitors/${m.id}`}>{m.name} ↗</Link>}</div>) : "—"}</dd></div>
    </dl>
    <div className="space-y-2 py-4">
      {!monitors.length && <p className="text-sm text-[var(--fg-dim)]">Monitor zuordnen, um die Runtime zu vergleichen.</p>}
      {monitors.map((monitor) => {
        const result = compareRuntime({ snapshot, lastError, applicationMissing, runtime: monitor.runtime, monitorEnabled: monitor.enabled, intervalSec: monitor.intervalSec });
        const text = result.level === "match" ? "Git und Runtime stimmen überein" : result.level === "mismatch" ? "Abweichung zwischen Git und Runtime" : "Abgleich nicht verifiziert";
        return <div key={monitor.id} className="text-sm">
          {monitors.length > 1 && <p className="mb-1 text-xs text-[var(--fg-dim)]">{monitor.name}</p>}
          <span className={`comparison-pill comparison-pill--${result.level}`}>{result.level === "match" && "✓ "}{text}</span>
          {result.level !== "match" && <p className="mt-2 text-xs leading-relaxed text-[var(--fg-dim)]">{result.reason}</p>}
        </div>;
      })}
    </div>
    <div className="repository-updates">
      <div className="mb-2 text-xs font-semibold text-[var(--fg-dim)]">Verfügbare Patches</div>
      {!lines.size && <p className="text-xs text-[var(--fg-dim)]">Noch keine Version für den Patchvergleich bekannt.</p>}
      {[...lines].map(([line, current]) => {
        const latest = registry ? latestOnLine(current[0], registry.versions) : null;
        const pending = latest && current.some((v) => semver.gt(latest, v));
        return <div key={line} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-[var(--fg-dim)]">{line}</span>
          {latest ? <span className={pending ? "text-[var(--amber)]" : ""}>{pending ? `${stale ? "Patch bekannt" : "Patch verfügbar"}: ${latest}` : `Neuester bekannter Patch: ${latest}`}</span> : <span className="text-[var(--fg-dim)]">Keine Release-Daten</span>}
        </div>;
      })}
      <p className="mt-2 text-xs leading-relaxed text-[var(--fg-dim)]">npm-Stand: {registryMeta.npmFetchedAt ? date(registryMeta.npmFetchedAt) : "noch nicht geladen"}{stale && " · Referenzdaten fehlen oder sind veraltet"}</p>
      {registryMeta.lastError && <p className="mt-2 text-xs text-[var(--amber)]">Referenzabruf: {registryMeta.lastError}</p>}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-[var(--fg-dim)]">{snapshot ? <>Git gelesen: <span className="font-mono">{snapshot.commitSha.slice(0, 8)}</span> · {date(snapshot.scannedAt)}</> : "Git noch nicht gelesen. Versionen prüfen, um den Stand abzurufen."}</p>
  </div>;
}
