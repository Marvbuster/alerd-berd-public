import { prisma } from "@/lib/prisma";
import { type PackageWatch, type VizNode, type VizStatus, parseHealthPayload } from "@/lib/viz";
import { evaluatePackage, loadWatchContext } from "@/lib/version-watch";

// Single Source of Truth für alle Monitor-Views (Registry, Sphere, …):
// baut aus Monitor + letzter Check-Historie + letztem Spec-Health-Payload die
// VizNode-Liste. Jede View rendert nur noch, statt selbst zu queren.
// applicationId: nur die Monitore, die an diesem Dienst hängen (Chat-Fenster).
export async function loadMonitorNodes(ownerId: string, applicationId?: string): Promise<VizNode[]> {
  const monitors = await prisma.monitor.findMany({
    where: { ownerId, ...(applicationId ? { coolifyLinks: { some: { applicationId } } } : {}) },
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
    include: { coolifyLinks: {
      where: { application: { connection: { ownerId } } },
      select: { application: { select: { id: true, name: true, missingSince: true, connection: { select: { label: true } } } } },
    } },
  });
  const ids = monitors.map((m) => m.id);

  // Verlauf und letzter Check für alle Monitore in je einer Abfrage. Früher zwei
  // Abfragen pro Monitor, bei ~50 Monitoren ~100 Stück pro Render, und die SSE-Route
  // rendert alle 8 Sekunden. LATERAL nutzt den Index (monitorId, checkedAt).
  type HistoryRow = { monitorId: string; status: string; responseTimeMs: number | null; checkedAt: Date };
  type LatestRow = { monitorId: string; payload: unknown; version: string | null; uptimeSec: number | null; checkedAt: Date };
  const [historyRows, latestRows] = ids.length ? await Promise.all([
    // Antwortzeit-Historie (letzte 48 Checks je Monitor).
    prisma.$queryRaw<HistoryRow[]>`SELECT m.id AS "monitorId", c.status::text AS status, c."responseTimeMs", c."checkedAt"
      FROM unnest(${ids}::text[]) AS m(id)
      CROSS JOIN LATERAL (SELECT status, "responseTimeMs", "checkedAt" FROM "Check" WHERE "monitorId" = m.id ORDER BY "checkedAt" DESC LIMIT 48) c`,
    // Letzter Check je Monitor → volles Spec-Health-Payload (components/metrics/version).
    prisma.$queryRaw<LatestRow[]>`SELECT m.id AS "monitorId", c.payload, c.version, c."uptimeSec", c."checkedAt"
      FROM unnest(${ids}::text[]) AS m(id)
      CROSS JOIN LATERAL (SELECT payload, version, "uptimeSec", "checkedAt" FROM "Check" WHERE "monitorId" = m.id ORDER BY "checkedAt" DESC LIMIT 1) c`,
  ]) : [[], []];
  const byMonitor = new Map<string, HistoryRow[]>();
  for (const row of historyRows) byMonitor.set(row.monitorId, [...(byMonitor.get(row.monitorId) ?? []), row]);
  // Neueste zuerst, wie vorher aus findMany(orderBy desc).
  const histories = monitors.map((m) => (byMonitor.get(m.id) ?? []).sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime()));
  const latestBy = new Map(latestRows.map((r) => [r.monitorId, r]));
  const latest = monitors.map((m) => latestBy.get(m.id) ?? null);

  // Versionswächter: live gemeldete Pakete + Referenzwissen (einmal pro Render).
  const [pkgRows, watchCtx] = await Promise.all([
    prisma.monitorPackage.findMany({ where: { monitorId: { in: ids } } }),
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
