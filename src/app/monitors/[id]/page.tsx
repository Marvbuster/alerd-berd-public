import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { loadMonitorNode } from "@/lib/monitor-view";
import { checkMonitorNow, resolvePushMonitor } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MonitorDetail } from "@/components/MonitorDetail";
import { STATUS_COLOR } from "@/lib/viz";
import { publicHost } from "@/lib/public-url";

// DB-getrieben — nie zur Build-Zeit rendern (Docker-Build hat nur eine Dummy-URL)
export const dynamic = "force-dynamic";

export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const node = await loadMonitorNode(id, user.id);
  if (!node) notFound(); // fremder/unbekannter Monitor → 404 (kein Infoleak)

  const color = STATUS_COLOR[node.status];

  // PUSH-Monitore: Ingest-URL zum Eintragen bei der Quelle + letztes Event.
  let pushUrl: string | null = null;
  let lastEvent: { event?: string; message?: string } | null = null;
  if (node.kind === "PUSH") {
    const m = await prisma.monitor.findUnique({ where: { id }, select: { ingestToken: true } });
    if (m?.ingestToken) {
      const h = await headers();
      const host = h.get("x-forwarded-host") ?? h.get("host") ?? publicHost();
      const proto = h.get("x-forwarded-proto") ?? "https";
      pushUrl = `${proto}://${host}/api/ingest/${m.ingestToken}`;
    }
    const lastCheck = await prisma.check.findFirst({
      where: { monitorId: id },
      orderBy: { checkedAt: "desc" },
      select: { payload: true },
    });
    const p = lastCheck?.payload as { event?: string; message?: string } | null;
    if (p && (p.event || p.message)) lastEvent = { event: p.event, message: p.message };
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link href={`/services#${node.coolifyApps.length ? `app-${node.coolifyApps[0].id}` : `mon-${node.id}`}`} className="btn btn--ghost">◀ Dienst</Link>
        <form action={checkMonitorNow.bind(null, node.id)}>
          <button type="submit" className="btn btn--ghost">↻ Jetzt prüfen</button>
        </form>
      </div>

      <div
        className="panel rounded-2xl p-5 sm:p-7"
        style={{ borderTop: `3px solid ${color}` }}
      >
        <MonitorDetail
          node={node}
          footerActions={
            <Link href={`/monitors/${node.id}/edit`} className="btn btn--ghost">Bearbeiten</Link>
          }
        />
      </div>

      {node.kind === "PUSH" && (
        <div className="panel mt-4 space-y-3 rounded-2xl p-5 sm:p-7">
          <h2 className="text-sm font-semibold">Push-Eingang</h2>
          {pushUrl ? (
            <div>
              <p className="mb-1 text-xs text-[var(--fg-dim)]">
                Diese URL bei der Quelle als Webhook-Ziel eintragen (z. B. Coolify → Notifications → Webhook):
              </p>
              <code className="block break-all rounded-md bg-black/30 px-3 py-2 text-sm text-[var(--fg)]">
                {pushUrl}
              </code>
              <p className="mt-1 text-xs text-[var(--fg-dim)]">
                Das Token in der URL ist das Secret — nicht öffentlich teilen.
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--fg-dim)]">Kein Ingest-Token gesetzt.</p>
          )}
          {lastEvent && (
            <p className="text-sm text-[var(--fg-dim)]">
              Letztes Event: <span className="text-[var(--fg)]">{lastEvent.event ?? "—"}</span>
              {lastEvent.message ? ` — ${lastEvent.message}` : ""}
            </p>
          )}
          {node.status !== "UP" && node.status !== "UNKNOWN" && (
            <form action={resolvePushMonitor.bind(null, node.id)} className="flex flex-wrap items-center gap-3">
              <button className="btn btn--ghost">Als behoben markieren</button>
              <span className="text-xs text-[var(--fg-dim)]">Wenn die Quelle keine Entwarnung schickt, etwa nach einer Bereinigung per Hand.</span>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
