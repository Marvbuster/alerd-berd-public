import type { VizNode } from "@/lib/viz";
import type { ServicePackage } from "@/lib/services";
import { PackageRow } from "./ServicePackages";

const ago = (date: Date) => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  return minutes < 60 ? `vor ${Math.max(1, minutes)} min` : minutes < 48 * 60 ? `vor ${Math.round(minutes / 60)} h` : `vor ${Math.round(minutes / 1440)} Tagen`;
};

// Version: Stand im Git und die Laufzeit. Die Pakete selbst, next eingeschlossen,
// stehen darunter in der Liste der beobachteten Pakete (ServicePackages).
export function ServiceVersion({ snapshot, lastError, node, liveCommit = null }: {
  checks?: VizNode[];
  liveCommit?: string | null;
  node?: ServicePackage | null;
  snapshot: { commitSha: string; scannedAt: Date } | null;
  latestPatch?: string | null;
  lastError: string | null;
}) {
  if (!snapshot && !node && !lastError && !liveCommit) return null;
  const proven = !!snapshot && !!liveCommit && (snapshot.commitSha.startsWith(liveCommit) || liveCommit.startsWith(snapshot.commitSha));
  return <dl className="service-facts">
    {snapshot && <div><dt>Git-Stand</dt><dd><span className="font-mono">{snapshot.commitSha.slice(0, 7)}</span><span className="service-meta" title={`Gelesen ${snapshot.scannedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`}>{ago(snapshot.scannedAt)}</span></dd></div>}
    {liveCommit && <div><dt>Live-Commit</dt><dd><span className="font-mono">{liveCommit.slice(0, 7)}</span>
      {snapshot && (proven ? <span className="service-meta" title="Live läuft genau der Git-Stand, alle Paketversionen sind belegt">= Git-Stand</span>
        : <span className="service-chip service-chip--warn" title="Live läuft ein anderer Commit als der zuletzt gelesene Git-Stand">≠ Git-Stand</span>)}
    </dd></div>}
    {node && <PackageRow pkg={{ ...node, latestPatch: node.latest && node.version && node.latest !== node.version ? node.latest : null }} label="Node" />}
    {lastError && <div><dt>Git</dt><dd className="text-[var(--amber)]">{lastError}</dd></div>}
  </dl>;
}
