import { prisma } from "@/lib/prisma";
import { type PackageWatch, type VizNode, type VizStatus, parseHealthPayload } from "@/lib/viz";
import { evaluatePackage, loadWatchContext } from "@/lib/version-watch";

// Single Source of Truth für alle Monitor-Views (Registry, Sphere, …):
// baut aus Monitor + letzter Check-Historie + letztem Spec-Health-Payload die
// VizNode-Liste. Jede View rendert nur noch, statt selbst zu queren.
export async function loadMonitorNodes(ownerId: string): Promise<VizNode[]> {
  const monitors = await prisma.monitor.findMany({
    where: { ownerId },
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    include: { coolifyLinks: {
      where: { application: { connection: { ownerId } } },
      select: { application: { select: { id: true, name: true, missingSince: true, connection: { select: { label: true } } } } },
    } },
  });

  // Antwortzeit-Historie (letzte 48 Checks, älteste→neueste; DOWN → null = Lücke).
  const histories = await Promise.all(
    monitors.map((m) =>
      prisma.check.findMany({
        where: { monitorId: m.id },
        orderBy: { checkedAt: "desc" },
        take: 48,
        select: { status: true, responseTimeMs: true, checkedAt: true },
      }),
    ),
  );

  // Letzter Check je Monitor → volles Spec-Health-Payload (components/metrics/version).
  const latest = await Promise.all(
    monitors.map((m) =>
      prisma.check.findFirst({
        where: { monitorId: m.id },
        orderBy: { checkedAt: "desc" },
        select: { payload: true, version: true, uptimeSec: true, checkedAt: true },
      }),
    ),
  );

  // Versionswächter: live gemeldete Pakete + Referenzwissen (einmal pro Render).
  const [pkgRows, watchCtx] = await Promise.all([
    prisma.monitorPackage.findMany({ where: { monitorId: { in: monitors.map((m) => m.id) } } }),
    loadWatchContext(),
  ]);
  const now = new Date();
  const packagesFor = (monitorId: string, kind: string): PackageWatch[] => {
    if (kind !== "HEALTH") return []; // nur Spec-Health-Monitore können Versionen melden
    // Nur was der Dienst in runtime meldet. Kein Paket ist Pflicht, auch next nicht.
    return pkgRows.filter((r) => r.monitorId === monitorId && !r.name.startsWith("runtime:")).map((r) => r.name).sort().map((name) => {
      const row = pkgRows.find((r) => r.monitorId === monitorId && r.name === name);
      const e = evaluatePackage(watchCtx, name, row?.version ?? null, now);
      return {
        name,
        version: row?.version ?? null,
        level: e.level,
        latest: e.latest,
        sinceMs: row?.firstSeenAt.getTime() ?? null,
        findings: e.findings,
      };
    });
  };

  return monitors.map((m, i) => {
    const health = parseHealthPayload(latest[i]?.payload);
    return {
      id: m.id,
      label: m.name,
      kind: m.kind,
      target: m.kind === "HEALTH" ? `${m.target}${m.healthPath ?? "/health"}` : m.target,
      status: m.currentStatus as VizStatus,
      responseMs: m.lastResponseMs,
      intervalSec: m.intervalSec,
      enabled: m.enabled,
      stateSinceMs: m.stateSince?.getTime() ?? null,
      uptimeSec: latest[i]?.uptimeSec ?? null,
      uptimeAtMs: latest[i]?.uptimeSec != null ? latest[i]!.checkedAt.getTime() : null,
      lastCheckedMs: m.lastCheckedAt?.getTime() ?? null,
      lastUpMs: m.lastUpAt?.getTime() ?? null,
      phase: m.phase,
      history: histories[i]
        .map((c) => ({ t: c.checkedAt.getTime(), ms: c.status === "DOWN" ? null : c.responseTimeMs, status: c.status as VizStatus }))
        .reverse(),
      version: health.version ?? latest[i]?.version ?? null,
      components: health.components,
      metrics: health.metrics,
      packages: packagesFor(m.id, m.kind),
      commit: pkgRows.find((r) => r.monitorId === m.id && r.name === "runtime:commit")?.version ?? null,
      coolifyApps: m.coolifyLinks.map(({ application: app }) => ({ id: app.id, name: app.name, connectionLabel: app.connection.label, missing: app.missingSince !== null })),
    };
  });
}

// Einzelner Node für die Detail-Seite — dieselbe Basis wie die Listen-Views.
// ownerId scoped mit: ein fremder Monitor ergibt null (→ 404 in der Page).
export async function loadMonitorNode(id: string, ownerId: string): Promise<VizNode | null> {
  const nodes = await loadMonitorNodes(ownerId);
  return nodes.find((n) => n.id === id) ?? null;
}
