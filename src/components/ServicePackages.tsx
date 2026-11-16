"use client";

import { useActionState, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { setWatchedPackages, type ActionState } from "@/app/services/actions";
import { WATCH_COLOR, WATCH_LABEL } from "@/lib/viz";
import type { ServicePackage } from "@/lib/services";
import type { UpdateCandidate } from "@/lib/dependency-target";
import type { DirectDependency } from "@/lib/repository-logic";

// Art des Updates kurz hinter der Zielversion, wie in „Update prüfen“.
function updateKind(c: UpdateCandidate): string | null {
  if (c.critical) return "kritischer Fix";
  if (c.security) return "Sicherheit";
  if (c.recommended) return c.recommended.hold ? "Major, abwarten" : "Major, empfohlen";
  return c.jump === "minor" ? "Minor" : c.jump === "major" ? "Major" : null;
}

function updateTitle(c: UpdateCandidate): string | undefined {
  return [c.recommended?.title, ...(c.knownIssues ?? []).map((k) => `Bekanntes Problem: ${k.title}`)].filter(Boolean).join("\n") || undefined;
}

// Beobachtete Pakete, next eingeschlossen: eine Zeile pro Paket, Version rechts, Stufe als
// Chip nur bei Handlungsbedarf. Darunter die Auswahl aus allen Abhängigkeiten.
export function PackageRow({ pkg, label }: { pkg: ServicePackage; label?: string }) {
  // Patch-Rückstand steht schon als „↑ Version“ in der Zeile, hier nur echte Meldungen.
  const serious = pkg.findings.filter((f) => (f.level === "red" || f.level === "orange") && f.kind !== "patch-backlog" && f.kind !== "newer-release");
  const color = WATCH_COLOR[pkg.level];
  return <div><dt className="font-mono" title={pkg.name}>{label ?? pkg.name}</dt><dd>
    {pkg.version ? <span className="font-mono">{pkg.version}</span> : <span className="text-[var(--fg-dim)]">nicht im Lockfile</span>}
    {pkg.source === "live" && <span className="service-meta" title="Vom Dienst über die Spec-Health gemeldet">live</span>}
    {pkg.source === "git" && <span className="service-meta" title="Version aus dem Lockfile im Git-Stand, der Dienst meldet sie nicht live">Git</span>}
    {pkg.source === "live" && pkg.gitVersion && pkg.gitVersion !== pkg.version && <span className="service-chip service-chip--warn" title={`Im Git-Stand steht ${pkg.gitVersion}`}>Git {pkg.gitVersion}</span>}
    {(pkg.level === "red" || pkg.level === "orange") && <span className="service-chip" style={{ color, borderColor: color }}>{WATCH_LABEL[pkg.level]}</span>}
    {pkg.update ? <span className="font-mono text-xs text-[var(--amber)]" title={updateTitle(pkg.update)}>↑ {pkg.update.to}{updateKind(pkg.update) && <span className="service-meta"> {updateKind(pkg.update)}</span>}</span>
      : pkg.latestPatch && <span className="font-mono text-xs text-[var(--amber)]">↑ {pkg.latestPatch}</span>}
    {serious.length > 0 && <details className="service-findings w-full"><summary style={{ color }}>{serious.length === 1 ? "1 Meldung" : `${serious.length} Meldungen`}</summary>
      <ul>{serious.map((f) => <li key={f.ghsaId ?? f.title} style={{ color: WATCH_COLOR[f.level] }}>
        {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.ghsaId ?? f.title}</a> : f.ghsaId ?? f.title}
        {f.ghsaId && <span className="service-meta"> · {f.title}</span>}{f.fixedIn ? <span className="service-meta"> · gefixt ab {f.fixedIn}</span> : null}
      </li>)}</ul>
    </details>}
  </dd></div>;
}

export function ServicePackages({ applicationId, packages, dependencies, scanned, readOnly }: {
  applicationId: string; packages: ServicePackage[]; dependencies: DirectDependency[]; scanned: boolean; readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <div className="mt-5">
    <h4 className="service-subhead">Pakete</h4>
    {packages.length > 0 && <dl className="service-facts">{packages.map((p) => <PackageRow key={p.name} pkg={p} />)}</dl>}
    {!readOnly && (!scanned ? <p className="service-hint">Die Abhängigkeiten liest Alerd beim nächsten Git-Scan, oder sofort mit „Versionen prüfen“.</p>
      : <button type="button" className="btn btn--ghost mt-3" onClick={() => setOpen(true)}>Pakete überwachen</button>)}
    {open && <PackagePicker applicationId={applicationId} watched={packages.map((p) => p.name)} dependencies={dependencies} onClose={() => setOpen(false)} />}
  </div>;
}

// Overlay statt Liste in der Seitenleiste: lange Abhängigkeitslisten, Suche,
// Laufzeit und Entwicklung getrennt. Liegt über der Sticky-Leiste (z-80).
function PackagePicker({ applicationId, watched, dependencies, onClose }: {
  applicationId: string; watched: string[]; dependencies: DirectDependency[]; onClose: () => void;
}) {
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
  const groups = [["Laufzeit", dependencies.filter((d) => !d.dev)], ["Entwicklung", dependencies.filter((d) => d.dev)]] as const;

  return <div className="dependency-modal-backdrop" role="presentation" onMouseDown={() => { if (!pending) onClose(); }}>
    <section className="dependency-modal package-modal" role="dialog" aria-modal="true" aria-label="Pakete überwachen" onMouseDown={(event) => event.stopPropagation()}>
      <div className="dependency-modal-header">
        <div><h2>Pakete überwachen</h2><p className="service-meta">{picked.length === 1 ? "1 ausgewählt" : `${picked.length} ausgewählt`} von {dependencies.length}</p></div>
        <button type="button" className="icon-button" aria-label="Schließen" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <form action={action} className="grid gap-4 pt-4">
        <label className="inventory-search"><Icon name="search" /><input type="search" aria-label="Pakete durchsuchen" placeholder="Pakete durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn--ghost" disabled={pending || picked.length === all.length} onClick={() => setPicked(all)}>Alle auswählen</button>
          <button type="button" className="btn btn--ghost" disabled={pending || !picked.length} onClick={() => setPicked([])}>Keine auswählen</button>
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
        {q && groups.every(([, list]) => !list.some((d) => d.name.toLowerCase().includes(q))) && <p className="service-hint">Kein Paket für diese Suche.</p>}
        <div className="package-modal-actions">
          <button className="btn" disabled={pending || !changed}>{pending ? "Speichere …" : "Speichern"}</button>
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={onClose}>Abbrechen</button>
          {state.message && !state.ok && <p role="status" className="text-xs text-[var(--amber)]">{state.message}</p>}
        </div>
      </form>
    </section>
  </div>;
}
