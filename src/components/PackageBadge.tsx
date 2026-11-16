import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";
import { localizedTitle } from "@/i18n/data";
import { type PackageWatch, WATCH_COLOR, localizedWATCH_LABEL as WATCH_LABEL } from "@/lib/viz";

// Versionswächter-Badge: "next 16.4.5" in der Farbe der Stufe. Eigenes Badge,
// bewusst getrennt von der Verfügbarkeits-LED. Tooltip = schlimmster Befund.
export function PackageBadge({ pkg }: { pkg: PackageWatch }) {
  const _locale = _useLocale();
  const color = WATCH_COLOR[pkg.level];
  const top = pkg.findings[0];
  const title = top
    ? `${WATCH_LABEL(_locale)[pkg.level]}: ${top.ghsaId ? `${top.ghsaId} ` : ""}${localizedTitle(top, _locale)}`
    : pkg.version
      ? `${pkg.name} ${pkg.version}: ${WATCH_LABEL(_locale)[pkg.level]}`
      : _t(_locale, "PackageBadge.mb2065fc359", { value0: pkg.name });
  return (
    <span
      className="tag shrink-0"
      title={title}
      style={pkg.level === "ok" ? undefined : { color, borderColor: color }}
    >
      {pkg.name} {pkg.version ?? "?"}
      {(pkg.level === "red" || pkg.level === "orange") && <> · {WATCH_LABEL(_locale)[pkg.level]}</>}
    </span>
  );
}
