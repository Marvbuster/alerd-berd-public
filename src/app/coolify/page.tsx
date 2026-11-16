import Link from "next/link";
import semver from "semver";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { credentialsConfigured } from "@/lib/credentials";
import { compareRuntime, githubRepository } from "@/lib/repository-logic";
import { loadWatchContext } from "@/lib/version-watch";
import { latestMatureOnLine } from "@/lib/dependency-target";
import { alreadyDelivered } from "@/lib/dependency-target";
import { ApplicationVisibilityForm, LinkMonitorForm, SyncForm } from "@/components/CoolifyForms";
import { RepositoryPanel } from "@/components/RepositoryForms";
import { RepositoryComparison } from "@/components/RepositoryComparison";
import { InventoryBrowser, type InventoryItem } from "@/components/InventoryBrowser";
import { DependencyAssistant } from "@/components/DependencyAssistant";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";
import { unlinkMonitor } from "./actions";

export const dynamic = "force-dynamic";
const date = (value: Date | null) => value ? `${value.toISOString().slice(0, 16).replace("T", " ")} UTC` : "noch nie";
const groupRank = { linked: 0, unlinked: 1, missing: 2 };

export default async function CoolifyPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [connections, monitors, claudeCredential, publishCredential, context] = await Promise.all([
    prisma.coolifyConnection.findMany({
      where: { ownerId: user.id }, orderBy: { createdAt: "asc" },
      select: {
        id: true, label: true, baseUrl: true, lastSyncedAt: true, lastError: true,
        applications: { orderBy: { name: "asc" }, select: {
          id: true, name: true, status: true, domains: true, repository: true, branch: true,
          baseDirectory: true, reportedCommit: true, buildPack: true, missingSince: true, hiddenAt: true,
          repositoryWatch: { select: { id: true, repository: true, branch: true, manifestPath: true, lockfilePath: true, lastError: true, snapshot: true } },
          dependencyJobs: { where: { ownerId: user.id }, orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, targetVersion: true, model: true, status: true, updatedAt: true, workerLockedUntil: true, workerAttemptAt: true, lastError: true, validationLog: true, messages: { orderBy: { createdAt: "asc" }, take: 50, select: { id: true, role: true, content: true, createdAt: true } } } },
          monitors: { where: { monitor: { ownerId: user.id } }, select: { monitorId: true } },
        } },
      },
    }),
    prisma.monitor.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, kind: true, enabled: true, intervalSec: true, packages: { where: { name: "next" }, select: { name: true, version: true, reportedAt: true } } }, orderBy: { name: "asc" } }),
    prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { connectedAt: true } }),
    prisma.gitHubPublishCredential.findUnique({ where: { ownerId: user.id }, select: { updatedAt: true } }),
    loadWatchContext(),
  ]);
  const configured = credentialsConfigured() && Boolean(process.env.COOLIFY_ALLOWED_ORIGINS?.trim());
  const items: InventoryItem[] = connections.flatMap((connection) => connection.applications.map((app): InventoryItem => {
    const linkedMonitors = app.monitors.flatMap((l) => { const m = monitors.find((m) => m.id === l.monitorId); return m ? [m] : []; });
    const group = app.missingSince ? "missing" : linkedMonitors.length ? "linked" : "unlinked";
    const watch = app.repositoryWatch;
    const lockedNext = watch?.snapshot?.lockedVersion ?? null;
    const knownPatch = lockedNext && context.registry.next ? latestMatureOnLine(lockedNext, context.registry.next.versions) : null;
    const dependencyJob = app.dependencyJobs[0] ?? null;
    const runtimeNext = linkedMonitors.flatMap((m) => m.packages.map((p) => p.version));
    const updateTarget = knownPatch && lockedNext && semver.gt(knownPatch, lockedNext)
      && !alreadyDelivered(knownPatch, { jobs: dependencyJob ? [dependencyJob] : [], runtimeVersions: runtimeNext }) ? knownPatch : null;
    let repo = ""; try { repo = githubRepository(app.repository ?? ""); } catch { /* Configure unsupported sources explicitly. */ }
    const dir = app.baseDirectory.replace(/^\/+|\/+$/g, "");
    const runtimeVersions = [...new Set(linkedMonitors.flatMap((m) => m.packages.map((p) => p.version)))];
    const results = linkedMonitors.map((m) => compareRuntime({ snapshot: watch?.snapshot ?? null, lastError: watch?.lastError ?? null, applicationMissing: !!app.missingSince, runtime: m.packages[0] ?? null, monitorEnabled: m.enabled, intervalSec: m.intervalSec }));
    const comparison = results.length ? results.some((r) => r.level === "mismatch") ? "mismatch" : results.every((r) => r.level === "match") ? "match" : "unknown" : null;
    return {
      id: app.id, name: app.name, domains: app.domains, status: app.status, group, hidden: !!app.hiddenAt,
      monitorNames: linkedMonitors.map((m) => m.name), repository: watch?.repository ?? app.repository,
      version: runtimeVersions.length === 1 ? runtimeVersions[0] : runtimeVersions.length > 1 ? "mehrere" : null, comparison,
      detail: <article id={`app-${app.id}`} className="panel inventory-detail" aria-label={`Details zu ${app.name}`}>
        <div className="mb-2 text-xs text-[var(--fg-dim)]">{connection.label} · {app.buildPack ?? "Build unbekannt"}</div>
        <h2>{app.name}</h2><p className="mt-2 break-all text-sm text-[var(--fg-dim)]">{app.domains || "Keine Domain hinterlegt"}</p>
        <div className="mt-3 flex flex-wrap gap-2"><span className={`connection-badge connection-badge--${group}`}>{group === "missing" ? "Nicht mehr gefunden" : linkedMonitors.length ? `${linkedMonitors.length} Monitor${linkedMonitors.length > 1 ? "e" : ""} verknüpft` : "Ohne Monitor"}</span><span className="tag">{app.status ?? "Status unbekannt"}</span></div>
        <div className="mt-4"><ApplicationVisibilityForm applicationId={app.id} hidden={!!app.hiddenAt} />{app.hiddenAt && <p className="mt-3 text-xs leading-relaxed text-[var(--fg-dim)]">Aus dem Inventar ausgeblendet. Git-Prüfungen sind pausiert; bestehende Monitore laufen weiter. Einblenden stellt die App samt Einstellungen und Zuordnungen wieder her.</p>}</div>
        <section className="detail-section"><h3>Verbindung</h3>
          {linkedMonitors.map((m) => <div key={m.id} className="mb-2 flex items-center justify-between gap-3"><Link href={`/monitors/${m.id}`} className="flex min-w-0 items-center gap-2 text-sm"><Icon name="link" size={17} /><span className="break-words">{m.name} ↗</span></Link><form action={unlinkMonitor.bind(null, app.id, m.id)}><button className="text-xs text-[var(--fg-dim)] hover:text-[var(--amber)]" aria-label={`Zuordnung zu ${m.name} lösen`}>Lösen</button></form></div>)}
          {!linkedMonitors.length && !app.missingSince && <p className="mb-3 text-sm text-[var(--fg-dim)]">Noch keinem Monitor zugeordnet.</p>}
          {app.missingSince && <p className="mb-3 text-xs text-[var(--fg-dim)]">Seit {date(app.missingSince)} nicht mehr von Coolify geliefert. Bestehende Zuordnungen bleiben erhalten.</p>}
          {!app.missingSince && !app.hiddenAt && <details className="disclosure mt-3" open={!linkedMonitors.length}><summary>{linkedMonitors.length ? "Weiteren Monitor zuordnen" : "Monitor zuordnen"}</summary><div className="disclosure-content"><LinkMonitorForm applicationId={app.id} monitors={monitors.filter((m) => !app.monitors.some((l) => l.monitorId === m.id)).map(({ id, name }) => ({ id, name }))} /></div></details>}
        </section>
        <section className="detail-section"><h3>Versionen</h3>
          <RepositoryPanel applicationId={app.id} watchId={watch?.id} lastError={watch?.lastError ?? null} readOnly={!!app.missingSince || !!app.hiddenAt} defaults={watch ? { repository: watch.repository, branch: watch.branch, manifestPath: watch.manifestPath, lockfilePath: watch.lockfilePath } : { repository: repo, branch: app.branch ?? "", manifestPath: `${dir ? `${dir}/` : ""}package.json`, lockfilePath: `${dir ? `${dir}/` : ""}package-lock.json` }}>
            {watch && <><p className="mb-4 break-all text-xs text-[var(--fg-dim)]">{watch.repository} · {watch.branch}</p><RepositoryComparison registry={context.registry.next} registryMeta={context.registryMeta.next} snapshot={watch.snapshot} lastError={watch.lastError} applicationMissing={!!app.missingSince} monitors={linkedMonitors.map((m) => ({ id: m.id, name: m.name, enabled: m.enabled, intervalSec: m.intervalSec, runtime: m.packages[0] ?? null }))} /></>}
          </RepositoryPanel>
        </section>
        <DependencyAssistant applicationId={app.id} applicationName={app.name} candidates={updateTarget ? [{ name: "next", from: "", to: updateTarget, jump: "patch", breaking: false, security: false, critical: false }] : []} hasClaude={!!claudeCredential} hasPublish={!!publishCredential} job={dependencyJob} />
        <details className="disclosure mt-6"><summary>Betriebsdetails</summary><dl className="disclosure-content space-y-3 break-all text-xs text-[var(--fg-dim)]"><div><dt className="mb-1 font-semibold">Repository laut Coolify</dt><dd>{app.repository ?? "nicht angegeben"}</dd></div><div><dt className="mb-1 font-semibold">Branch / App-Verzeichnis</dt><dd>{app.branch ?? "?"} · {app.baseDirectory}</dd></div><div><dt className="mb-1 font-semibold">Commit laut API-Konfiguration</dt><dd>{app.reportedCommit?.slice(0, 12) ?? "unbekannt"} · nicht als Runtime bestätigt</dd></div></dl></details>
      </article>,
    };
  })).sort((a, b) => groupRank[a.group] - groupRank[b.group] || a.name.localeCompare(b.name));
  return <main className="mx-auto max-w-[1480px] px-4 py-8 sm:px-7">
    <PageHeader title="App-Inventar" description="Alle Anwendungen. Ein klarer Überblick." actions={<><Link href="/settings/access" className="icon-button" title="Zugänge verwalten" aria-label="Zugänge verwalten"><Icon name="settings" /></Link>{connections.map((connection) => <div key={connection.id}>{connections.length > 1 && <span className="mr-2 text-xs text-[var(--fg-dim)]">{connection.label}</span>}<SyncForm id={connection.id} /></div>)}</>} />
    {!configured && <p role="status" className="repository-warning mb-6">Für die Verbindung müssen CREDENTIAL_ENCRYPTION_KEY und COOLIFY_ALLOWED_ORIGINS im Alerd-Container gesetzt sein. Anleitung in der README.</p>}
    {connections.filter((c) => c.lastError).map((c) => <p role="status" key={c.id} className="repository-warning mb-4">{c.label}: {c.lastError} · Inventar zeigt den letzten erfolgreichen Stand.</p>)}
    {!connections.length && <p className="panel p-5 text-sm text-[var(--fg-dim)]">Noch keine Coolify-Verbindung. <Link href="/settings/access">Unter Einstellungen → Zugänge verbinden</Link></p>}
    {connections.length > 0 && <InventoryBrowser items={items} initialView={params.view ?? "all"} initialQuery={typeof params.q === "string" ? params.q.slice(0, 120) : ""} />}
    <div className="mt-5 flex flex-wrap gap-4 text-xs text-[var(--fg-dim)]">{connections.map((c) => <span key={c.id} className="inline-flex items-center gap-2"><Icon name="refresh" size={15} />{c.label} · Letzter Import {date(c.lastSyncedAt)}</span>)}</div>
  </main>;
}
