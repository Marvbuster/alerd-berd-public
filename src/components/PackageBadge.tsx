import { type PackageWatch, WATCH_COLOR, WATCH_LABEL } from "@/lib/viz";

// Versionswächter-Badge: "next 16.4.5" in der Farbe der Stufe. Eigenes Badge,
// bewusst getrennt von der Verfügbarkeits-LED. Tooltip = schlimmster Befund.
export function PackageBadge({ pkg }: { pkg: PackageWatch }) {
  const color = WATCH_COLOR[pkg.level];
  const top = pkg.findings[0];
  const title = top
    ? `${WATCH_LABEL[pkg.level]}: ${top.ghsaId ? `${top.ghsaId} ` : ""}${top.title}`
    : pkg.version
      ? `${pkg.name} ${pkg.version}: ${WATCH_LABEL[pkg.level]}`
      : `${pkg.name}: Dienst meldet runtime.packages nicht`;
  return (
    <span
      className="tag shrink-0"
      title={title}
      style={pkg.level === "ok" ? undefined : { color, borderColor: color }}
    >
      {pkg.name} {pkg.version ?? "?"}
      {(pkg.level === "red" || pkg.level === "orange") && <> · {WATCH_LABEL[pkg.level]}</>}
    </span>
  );
}
