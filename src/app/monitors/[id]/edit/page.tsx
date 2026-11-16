import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
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
  const _locale = await _getLocale();
  const { id } = await params;
  const user = await requireUser();
  // Nur eigene Monitore editierbar — fremder/unbekannter → 404.
  const monitor = await prisma.monitor.findFirst({ where: { id, ownerId: user.id } });
  if (!monitor) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-7">
      <PageHeader title={_t(_locale, "monitors_id_edit.m023faa3a6c")} description={monitor.name} icon="settings" actions={<Link href={`/monitors/${monitor.id}`} className="btn btn--ghost">{_t(_locale, "monitors_id_edit.me00fb9989f")}</Link>} />
      <div className="panel p-5 sm:p-7"><MonitorForm action={updateMonitor.bind(null, monitor.id)} monitor={monitor} submitLabel={_t(_locale, "monitors_id_edit.m6c86b99088")} /></div>

      {/* Danger Zone — Löschen bewusst nur hier, nicht im Dashboard */}
      <div className="mt-10 flex flex-col gap-3 rounded-md border border-[color-mix(in_srgb,var(--red)_35%,transparent)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-[var(--fg-dim)]">
          {_t(_locale, "monitors_id_edit.mef5e4e7f52")}{monitor.name}{_t(_locale, "monitors_id_edit.ma548dbf53d")}</div>
        <DeleteButton action={deleteMonitor.bind(null, monitor.id)} name={monitor.name} />
      </div>
    </main>
  );
}
