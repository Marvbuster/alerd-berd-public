import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadServices } from "@/lib/services";
import { githubRepository } from "@/lib/repository-logic";
import { dependencyPhase } from "@/lib/dependency-phase";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";
import { ServicesBrowser, type ServiceItem } from "@/components/ServicesBrowser";
import { ServiceVersion } from "@/components/ServiceVersion";
import { RepositoryPanel } from "@/components/RepositoryForms";
import { DependencyAssistant } from "@/components/DependencyAssistant";
import { RemoveServiceButton } from "@/components/RemoveServiceButton";
import { BuildEnvForm } from "@/components/BuildEnvForm";
import { ServicePackages } from "@/components/ServicePackages";
import { SphereView } from "@/components/sphere/SphereView";

// Dienste: Coolify-Apps, die du als Dienst angelegt hast. Monitore, Version
// und Update an einem Ort (Konzept: alerd-board/product/konzept).
export const dynamic = "force-dynamic";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string; q?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [{ services, pool, others, nodes }, connections, claude, publish, localNode, { busy: workerBusy, lastSeen: workerLastSeen }] = await Promise.all([
    loadServices(user.id),
    prisma.coolifyConnection.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, lastError: true } }),
    prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
    prisma.gitHubPublishCredential.findUnique({ where: { ownerId: user.id }, select: { ownerId: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { ownerId: true, lastSeenAt: true } }),
    loadWorkerStatus(),
  ]);

  if (params.view === "sphere") return <SphereView nodes={nodes} canEdit backHref="/services" backLabel="◀ Dienste" />;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const now = new Date();
  const items: ServiceItem[] = services.map((s) => {
    const monitors = s.checkIds.map((id) => byId.get(id)).filter((n) => !!n);
    const app = s.app;
    const watch = app.watch;
    const dir = app.baseDirectory.replace(/^\/+|\/+$/g, "");
    let repo = ""; try { repo = githubRepository(app.repository ?? ""); } catch { /* andere Quelle: in der Versionsüberwachung eintragen */ }
    // Versionen und Updates kommen aus Lockfile und Repo, dafür reicht ein GitHub-Repo an
    // der Coolify-App. Spec-Health liefert zusätzlich die Live-Version und den Live-Beleg
    // nach dem Deploy; ohne sie endet ein Update als „live, nicht belegt“.
    const hasSpec = monitors.some((m) => m.kind === "HEALTH");
    const detail = <>
      {(hasSpec || watch || !!repo) && <section className="service-section">
        <h3>Version</h3>
        <RepositoryPanel applicationId={app.id} watchId={watch?.id} lastError={watch?.lastError ?? null} readOnly={app.missing}
          defaults={watch ? { repository: watch.repository, branch: watch.branch, manifestPath: watch.manifestPath, lockfilePath: watch.lockfilePath } : { repository: repo, branch: app.branch ?? "", manifestPath: `${dir ? `${dir}/` : ""}package.json`, lockfilePath: `${dir ? `${dir}/` : ""}package-lock.json` }}>
          {watch ? <ServiceVersion checks={monitors} snapshot={watch.snapshot} latestPatch={s.latestPatch} lastError={watch.lastError} node={s.node} liveCommit={s.liveCommit} />
            : <ServiceVersion checks={monitors} snapshot={null} latestPatch={null} lastError={null} node={s.node} liveCommit={s.liveCommit} />}
          {watch && <ServicePackages applicationId={app.id} packages={s.packages} dependencies={s.dependencies} scanned={!!watch.snapshot && Array.isArray(watch.snapshot.dependencies)} readOnly={app.missing} />}
        </RepositoryPanel>
        {watch && !app.missing && <BuildEnvForm applicationId={app.id} initial={watch.buildEnv ?? ""} />}
      </section>}
      {watch && !app.missing && (s.candidates.length > 0 || s.job) && <DependencyAssistant applicationId={app.id} applicationName={s.name} candidates={s.candidates} hasClaude={!!claude} hasLocalNode={!!localNode} localNodeOnline={!!localNode?.lastSeenAt && Date.now() - localNode.lastSeenAt.getTime() < 10 * 60_000} hasPublish={!!publish} job={s.job} workerBusy={workerBusy} workerLastSeen={workerLastSeen} />}
      <details className="disclosure mt-6"><summary>Details</summary><div className="disclosure-content">
        <dl className="service-facts">
          <div><dt>Coolify</dt><dd>{app.connectionLabel} · {app.status ?? "Status unbekannt"}</dd></div>
          <div><dt>Repository</dt><dd className="break-all">{app.repository ?? "—"}</dd></div>
          <div><dt>Branch</dt><dd>{app.branch ?? "—"}{dir ? ` · ${dir}` : ""}</dd></div>
          <div><dt>Build</dt><dd>{app.buildPack ?? "—"}</dd></div>
          {app.missing && <div><dt>Hinweis</dt><dd className="text-[var(--amber)]">Nicht mehr in Coolify gefunden</dd></div>}
        </dl>
        <div className="mt-4"><RemoveServiceButton applicationId={app.id} name={s.name} /></div>
      </div></details>
    </>;
    return {
      id: s.id, name: s.name, domain: s.domain, checkIds: s.checkIds, applicationId: app.id, missing: app.missing,
      meta: `Coolify · ${app.connectionLabel}`,
      liveNext: s.liveNext, watchLevel: s.watchLevel, updateTarget: s.updateTarget, jobActive: s.jobActive,
      alertLevel: s.alertLevel, packageUpdates: s.packageUpdates,
      updateLabel: s.candidates.length === 1 ? `${s.candidates[0].name === "next" ? "Next" : s.candidates[0].name} ${s.candidates[0].to}` : s.candidates.length ? `${s.candidates.length} Updates` : null,
      jobActor: s.job ? dependencyPhase(s.job, now, { hasPublish: !!publish, workerBusy, workerLastSeen }).actor : null,
      hasRepo: !!repo && !!app.branch, hasWatch: !!watch,
      search: [app.repository, ...monitors.map((m) => `${m.label} ${m.target}`)].filter(Boolean).join(" "),
      mergeMonitors: s.mergeMonitors, detail,
    };
  });

  return <main className="mx-auto max-w-[1480px] px-4 py-8 sm:px-7">
    {connections.filter((c) => c.lastError).map((c) => <p role="status" key={c.id} className="repository-warning mb-4">{c.label}: {c.lastError}</p>)}
    <ServicesBrowser items={items} pool={pool} otherIds={others} connections={connections.map(({ id, label }) => ({ id, label }))} nodes={nodes}
      initialFilter={params.filter ?? "all"} initialQuery={typeof params.q === "string" ? params.q.slice(0, 120) : ""} />
  </main>;
}
