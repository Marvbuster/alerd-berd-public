import { utcDateTime } from "@/i18n/locale";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";
import type { VizNode } from "@/lib/viz";
import type { ServicePackage } from "@/lib/services";
import { PackageRow } from "./ServicePackages";

const ago = (date: Date, _locale: string = "de") => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  return minutes < 60 ? _t(_locale, "ServiceVersion.mbb89f4e8af", { value0: Math.max(1, minutes) }) : minutes < 48 * 60 ? _t(_locale, "ServiceVersion.m927f44719c", { value0: Math.round(minutes / 60) }) : _t(_locale, "ServiceVersion.md3f29ddf7e", { value0: Math.round(minutes / 1440) });
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
  const _locale = _useLocale();
  if (!snapshot && !node && !lastError && !liveCommit) return null;
  const proven = !!snapshot && !!liveCommit && (snapshot.commitSha.startsWith(liveCommit) || liveCommit.startsWith(snapshot.commitSha));
  return <dl className="service-facts">
    {snapshot && <div><dt>{_t(_locale, "ServiceVersion.mda4ebac01e")}</dt><dd><span className="font-mono">{snapshot.commitSha.slice(0, 7)}</span><span className="service-meta" title={_t(_locale, "ServiceVersion.mf74655e7a5", { value0: utcDateTime(snapshot.scannedAt, _locale) })}>{ago(snapshot.scannedAt, _locale)}</span></dd></div>}
    {liveCommit && <div><dt>{_t(_locale, "ServiceVersion.m2149e9cf3b")}</dt><dd><span className="font-mono">{liveCommit.slice(0, 7)}</span>
      {snapshot && (proven ? <span className="service-meta" title={_t(_locale, "ServiceVersion.m3d8aae0a34")}>{_t(_locale, "ServiceVersion.m5c25d6f8df")}</span>
        : <span className="service-chip service-chip--warn" title={_t(_locale, "ServiceVersion.m60f4b5a81b")}>{_t(_locale, "ServiceVersion.m07325ba79c")}</span>)}
    </dd></div>}
    {node && <PackageRow pkg={{ ...node, latestPatch: node.latest && node.version && node.latest !== node.version ? node.latest : null }} label={_t(_locale, "ServiceVersion.me93372533f")} />}
    {lastError && <div><dt>{_t(_locale, "ServiceVersion.mb949c922b6")}</dt><dd className="text-[var(--amber)]">{_message(_locale, lastError)}</dd></div>}
  </dl>;
}
