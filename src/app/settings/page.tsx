import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { addEmailChannel, toggleChannel, deleteChannel, setDailyUpdateDigest } from "@/lib/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { PushButton } from "@/components/PushButton";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const channels = await prisma.alertChannel.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
  });
  const digest = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { dailyUpdateDigest: true } });
  const emailVia = process.env.BREVO_API_KEY ? "Brevo" : process.env.SMTP_HOST ? "SMTP" : null;
  const vapidOk = !!process.env.VAPID_PUBLIC_KEY;

  return (
    <>

      {/* Kanäle */}
      <h2 className="mb-2 text-xs font-medium text-[var(--fg-dim)]">Alarm-Kanäle</h2>
      {channels.length === 0 ? (
        <p className="panel px-4 py-4 text-sm text-[var(--fg-dim)]">Noch keine Kanäle.</p>
      ) : (
        <div className="panel divide-y divide-[var(--fg-faint)]">
          {channels.map((c) => {
            const cfg = c.config as { to?: string; endpoint?: string } | null;
            const detail = c.kind === "EMAIL" ? cfg?.to : cfg?.endpoint?.slice(0, 42) + "…";
            return (
              <div key={c.id} className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${c.enabled ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tag">{c.kind}</span>
                    <span>{c.label}</span>
                  </div>
                  <div className="truncate text-xs text-[var(--fg-dim)]">{detail}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <form action={toggleChannel.bind(null, c.id, !c.enabled)}>
                    <button className="btn btn--ghost">{c.enabled ? "Pausieren" : "Aktivieren"}</button>
                  </form>
                  <DeleteButton action={deleteChannel.bind(null, c.id)} name={c.label} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* E-Mail hinzufügen */}
      <form action={addEmailChannel} className="panel mt-4 flex flex-wrap items-end gap-3 p-5">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-[var(--fg-dim)]">
            E-Mail-Alarm hinzufügen
          </label>
          <input name="email" type="email" required placeholder="name@example.com" />
        </div>
        <button className="btn">hinzufügen</button>
      </form>

      <section className="panel mt-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div><h2 className="text-sm font-semibold">Morgenreport für Paket-Updates</h2><p className="mt-1 text-xs text-[var(--fg-dim)]">Ab 08:00 Uhr an aktive E-Mail-Kanäle, nur an Tagen mit reifen Updates. Deployt wird nie automatisch.</p></div>
        <form action={setDailyUpdateDigest.bind(null, !digest.dailyUpdateDigest)}><button className="btn btn--ghost">{digest.dailyUpdateDigest ? "Deaktivieren" : "Aktivieren"}</button></form>
      </section>

      {/* Web Push */}
      <h2 className="mb-2 mt-8 text-xs font-medium text-[var(--fg-dim)]">Push aufs Handy</h2>
      <div className="panel p-4">
        <PushButton />
        <p className="mt-3 text-xs text-[var(--fg-dim)]">
          Als PWA zum Home-Screen hinzufügen für Push auf iOS/Android. Braucht gesetzte VAPID-Keys.
        </p>
      </div>

      {/* Status der Zustellwege */}
      <div className="mt-6 flex gap-4 text-xs text-[var(--fg-dim)]">
        <span>
          <span className="led mr-1.5 inline-block align-middle" style={{ background: emailVia ? "var(--up)" : "var(--unknown)" }} />
          E-Mail {emailVia ? `via ${emailVia}` : "nicht gesetzt (Dry-Run)"}
        </span>
        <span>
          <span className="led mr-1.5 inline-block align-middle" style={{ background: vapidOk ? "var(--up)" : "var(--unknown)" }} />
          VAPID {vapidOk ? "konfiguriert" : "nicht gesetzt (Dry-Run)"}
        </span>
      </div>
    </>
  );
}
