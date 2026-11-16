import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { updateMonitor, deleteMonitor } from "@/lib/actions";
import { MonitorForm } from "@/components/MonitorForm";
import { DeleteButton } from "@/components/DeleteButton";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditMonitor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  // Nur eigene Monitore editierbar — fremder/unbekannter → 404.
  const monitor = await prisma.monitor.findFirst({ where: { id, ownerId: user.id } });
  if (!monitor) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-7">
      <PageHeader title="Monitor bearbeiten" description={monitor.name} icon="settings" actions={<Link href={`/monitors/${monitor.id}`} className="btn btn--ghost">Zurück zum Monitor</Link>} />
      <div className="panel p-5 sm:p-7"><MonitorForm action={updateMonitor.bind(null, monitor.id)} monitor={monitor} submitLabel="Änderungen speichern" /></div>

      {/* Danger Zone — Löschen bewusst nur hier, nicht im Dashboard */}
      <div className="mt-10 flex flex-col gap-3 rounded-md border border-[color-mix(in_srgb,var(--red)_35%,transparent)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-[var(--fg-dim)]">
          Monitor „{monitor.name}" dauerhaft löschen — inkl. Historie &amp; Incidents.
        </div>
        <DeleteButton action={deleteMonitor.bind(null, monitor.id)} name={monitor.name} />
      </div>
    </main>
  );
}
