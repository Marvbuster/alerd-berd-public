"use client";
import { localizedTitle } from "@/i18n/data";

import { translateMessage as _message } from "@/i18n/translate";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import { useActionState, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { setWatchedPackages, type ActionState } from "@/app/services/actions";
import { WATCH_COLOR, localizedWATCH_LABEL as WATCH_LABEL } from "@/lib/viz";
import type { ServicePackage } from "@/lib/services";
import type { UpdateCandidate } from "@/lib/dependency-target";
import type { DirectDependency } from "@/lib/repository-logic";

// Art des Updates kurz hinter der Zielversion, wie in „Update prüfen“.
function updateKind(c: UpdateCandidate, _locale: string = "de"): string | null {
  if (c.critical) return _t(_locale, "ServicePackages.m038a924d18");
  if (c.security) return _t(_locale, "common.security");
  if (c.recommended) return c.recommended.hold ? _t(_locale, "ServicePackages.ma0a128c98c") : _t(_locale, "ServicePackages.m8dc5c3f056");
  return c.jump === "minor" ? "Minor" : c.jump === "major" ? "Major" : null;
}

function updateTitle(c: UpdateCandidate, _locale: string = "de"): string | undefined {
  return [(c.recommended ? localizedTitle(c.recommended, _locale) : undefined), ...(c.knownIssues ?? []).map((k) => _t(_locale, "ServicePackages.mc50aa5ed90", { value0: localizedTitle(k, _locale) }))].filter(Boolean).join("\n") || undefined;
}

// Paketzeile: Version rechts, Stufe als Chip bei Handlungsbedarf.
export function PackageRow({ pkg, label }: { pkg: ServicePackage; label?: string }) {
  const _locale = _useLocale();
  // Patch-Rückstand steht schon als „↑ Version“ in der Zeile, hier nur echte Meldungen.
  const serious = pkg.findings.filter((f) => (f.level === "red" || f.level === "orange") && f.kind !== "patch-backlog" && f.kind !== "newer-release");
  const color = WATCH_COLOR[pkg.level];
  return <div><dt className="font-mono" title={pkg.name}>{label ?? pkg.name}</dt><dd>
    {pkg.version ? <span className="font-mono">{pkg.version}</span> : <span className="text-[var(--fg-dim)]">{_t(_locale, "ServicePackages.mcfc7b52ab5")}</span>}
    {pkg.source === "live" && <span className="service-meta" title={_t(_locale, "ServicePackages.mde8a6ebb67")}>{_t(_locale, "ServicePackages.m247610f4de")}</span>}
    {pkg.source === "git" && <span className="service-meta" title={_t(_locale, "ServicePackages.mdf11a29649")}>{_t(_locale, "ServicePackages.mb949c922b6")}</span>}
    {pkg.source === "live" && pkg.gitVersion && pkg.gitVersion !== pkg.version && <span className="service-chip service-chip--warn" title={_t(_locale, "ServicePackages.m6814434f89", { value0: pkg.gitVersion })}>{_t(_locale, "ServicePackages.mbc31265854")}{pkg.gitVersion}</span>}
    {(pkg.level === "red" || pkg.level === "orange") && <span className="service-chip" style={{ color, borderColor: color }}>{WATCH_LABEL(_locale)[pkg.level]}</span>}
    {pkg.update ? <span className="font-mono text-xs text-[var(--amber)]" title={updateTitle(pkg.update, _locale)}>↑ {pkg.update.to}{updateKind(pkg.update, _locale) && <span className="service-meta"> {updateKind(pkg.update, _locale)}</span>}</span>
      : pkg.latestPatch && <span className="font-mono text-xs text-[var(--amber)]">↑ {pkg.latestPatch}</span>}
    {serious.length > 0 && <details className="service-findings w-full"><summary style={{ color }}>{serious.length === 1 ? _t(_locale, "ServicePackages.m1d74958c9c") : _t(_locale, "ServicePackages.m8b7c8e2430", { value0: serious.length })}</summary>
      <ul>{serious.map((f) => <li key={f.ghsaId ?? localizedTitle(f, _locale)} style={{ color: WATCH_COLOR[f.level] }}>
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.ghsaId ?? localizedTitle(f, _locale)}</a> : f.ghsaId ?? localizedTitle(f, _locale)}
        {f.ghsaId && <span className="service-meta"> · {localizedTitle(f, _locale)}</span>}{f.fixedIn ? <span className="service-meta"> {_t(_locale, "ServicePackages.mbccb769eca")}{f.fixedIn}</span> : null}
      </li>)}</ul>
    </details>}
  </dd></div>;
}

export function ServicePackages({ applicationId, packages, dependencies, scanned, readOnly }: {
  applicationId: string; packages: ServicePackage[]; dependencies: DirectDependency[]; scanned: boolean; readOnly: boolean;
}) {
  const _locale = _useLocale();
  const [open, setOpen] = useState(false);
  // Nur Pakete mit Handlungsbedarf: ein Update, ein Patch-Rückstand oder ein ernster
  // Befund. Aktuelle Pakete ohne Meldung verlängern die Seitenleiste nur.
  const flaggedPackages = packages.filter((pkg) => !!pkg.update || !!pkg.latestPatch || pkg.level === "red" || pkg.level === "orange");
  return <div className="mt-5">
    <h4 className="service-subhead">{_t(_locale, "ServicePackages.me1a11ce2f7")}</h4>
    {flaggedPackages.length > 0
      ? <dl className="service-facts">{flaggedPackages.map((p) => <PackageRow key={p.name} pkg={p} />)}</dl>
      : packages.length > 0 && <p className="service-hint">{_t(_locale, "ServicePackages.noFindings")}</p>}
    {!readOnly && (!scanned ? <p className="service-hint">{_t(_locale, "ServicePackages.m32292f2de0")}</p>
      : <button type="button" className="btn btn--ghost mt-3" onClick={() => setOpen(true)}>{_t(_locale, "ServicePackages.m6240951655")}</button>)}
    {open && <PackagePicker applicationId={applicationId} watched={packages.map((p) => p.name)} dependencies={dependencies} onClose={() => setOpen(false)} />}
  </div>;
}

// Overlay statt Liste in der Seitenleiste: lange Abhängigkeitslisten, Suche,
// Laufzeit und Entwicklung getrennt. Liegt über der Sticky-Leiste (z-80).
function PackagePicker({ applicationId, watched, dependencies, onClose }: {
  applicationId: string; watched: string[]; dependencies: DirectDependency[]; onClose: () => void;
}) {
  const _locale = _useLocale();
  const [picked, setPicked] = useState<string[]>(watched);
  const [query, setQuery] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await setWatchedPackages(applicationId, previous, form);
    if (result.ok) onClose();
    return result;
  }, {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);
  const toggle = (name: string) => setPicked((list) => list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);
  const all = dependencies.map((dependency) => dependency.name);
  const changed = picked.length !== watched.length || picked.some((n) => !watched.includes(n));
  const q = query.trim().toLowerCase();
  const groups = [[_t(_locale, "common.runtime"), dependencies.filter((d) => !d.dev)], [_t(_locale, "common.development"), dependencies.filter((d) => d.dev)]] as const;

  return <div className="dependency-modal-backdrop" role="presentation" onMouseDown={() => { if (!pending) onClose(); }}>
    <section className="dependency-modal package-modal" role="dialog" aria-modal="true" aria-label={_t(_locale, "ServicePackages.m6240951655")} onMouseDown={(event) => event.stopPropagation()}>
      <div className="dependency-modal-header">
        <div><h2>{_t(_locale, "ServicePackages.m6240951655")}</h2><p className="service-meta">{picked.length === 1 ? _t(_locale, "ServicePackages.m4cac0ad6d9") : _t(_locale, "ServicePackages.mdcd08c627e", { value0: picked.length })} {_t(_locale, "ServicePackages.m24db69445a")}{dependencies.length}</p></div>
        <button type="button" className="icon-button" aria-label={_t(_locale, "ServicePackages.mb808f6e970")} onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <form action={action} className="grid gap-4 pt-4">
        <label className="inventory-search"><Icon name="search" /><input type="search" aria-label={_t(_locale, "ServicePackages.maf0352ec3e")} placeholder={_t(_locale, "ServicePackages.m6a7b7c7aee")} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn--ghost" disabled={pending || picked.length === all.length} onClick={() => setPicked(all)}>{_t(_locale, "ServicePackages.m31f0ae31d4")}</button>
          <button type="button" className="btn btn--ghost" disabled={pending || !picked.length} onClick={() => setPicked([])}>{_t(_locale, "ServicePackages.m0fdbacc3c8")}</button>
        </div>
        {/* Auch gefilterte, aber gewählte Pakete mitschicken, sonst würde die Suche sie abwählen. */}
        {picked.filter((name) => q && !name.toLowerCase().includes(q)).map((name) => <input key={name} type="hidden" name="package" value={name} />)}
        {groups.map(([label, list]) => {
          const visible = list.filter((d) => !q || d.name.toLowerCase().includes(q));
          return visible.length > 0 && <fieldset key={label} className="grid gap-1">
            <legend className="service-hint mb-1">{label}</legend>
            <ul className="service-pool service-pool--compact">{visible.map((d) => <li key={d.name}>
              <label className={picked.includes(d.name) ? "is-picked" : undefined}>
                <input type="checkbox" name="package" value={d.name} checked={picked.includes(d.name)} onChange={() => toggle(d.name)} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.name}</span>
                <span className="service-meta font-mono">{d.locked ?? d.declared}</span>
              </label>
            </li>)}</ul>
          </fieldset>;
        })}
        {q && groups.every(([, list]) => !list.some((d) => d.name.toLowerCase().includes(q))) && <p className="service-hint">{_t(_locale, "ServicePackages.m4f6631d650")}</p>}
        <div className="package-modal-actions">
          <button className="btn" disabled={pending || !changed}>{pending ? _t(_locale, "ServicePackages.mb5a728f06d") : _t(_locale, "ServicePackages.mf6b2ff39f5")}</button>
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={onClose}>{_t(_locale, "ServicePackages.mf7ff1178af")}</button>
          {state.message && !state.ok && <p role="status" className="text-xs text-[var(--amber)]">{_message(_locale, state.message)}</p>}
        </div>
      </form>
    </section>
  </div>;
}
