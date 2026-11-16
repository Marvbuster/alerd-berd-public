import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { addEmailChannel, toggleChannel, deleteChannel, setDailyUpdateDigest } from "@/lib/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { PushButton } from "@/components/PushButton";
import { setLocale } from "./locale-actions";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const _locale = await _getLocale();
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
      <section className="panel mb-6 p-5">
        <h2 className="mb-3 text-sm font-semibold">{_t(_locale, "settings.me267d34382")}</h2>
        <form action={setLocale} className="flex items-end gap-3">
          <label className="text-xs">{_t(_locale, "settings.mf2a1cc71fa")}<select name="locale" defaultValue={_locale}>
              <option value="de">{_t(_locale, "settings.m801cfe0fa1")}</option>
              <option value="en">{_t(_locale, "settings.mba118bf7fc")}</option>
            </select>
          </label>
          <button className="btn">{_t(_locale, "settings.mf6b2ff39f5")}</button>
        </form>
      </section>

      {/* Kanäle */}
      <h2 className="mb-2 text-xs font-medium text-[var(--fg-dim)]">{_t(_locale, "settings.mac1b7713aa")}</h2>
      {channels.length === 0 ? (
        <p className="panel px-4 py-4 text-sm text-[var(--fg-dim)]">{_t(_locale, "settings.md71398b262")}</p>
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
                    <button className="btn btn--ghost">{c.enabled ? _t(_locale, "settings.m75a303be13") : _t(_locale, "settings.mcfc6942928")}</button>
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
            {_t(_locale, "settings.mc3a770cf6f")}</label>
          <input name="email" type="email" required placeholder={_t(_locale, "settings.m7b17fb0bd1")} />
        </div>
        <button className="btn">{_t(_locale, "settings.m9dc854b5f8")}</button>
      </form>

      <section className="panel mt-4 flex flex-wrap items-center justify-between gap-4 p-5">
        <div><h2 className="text-sm font-semibold">{_t(_locale, "settings.meba9ba6618")}</h2><p className="mt-1 text-xs text-[var(--fg-dim)]">{_t(_locale, "settings.mb6f064d913")}</p></div>
        <form action={setDailyUpdateDigest.bind(null, !digest.dailyUpdateDigest)}><button className="btn btn--ghost">{digest.dailyUpdateDigest ? _t(_locale, "settings.m7a86e994b5") : _t(_locale, "settings.mcfc6942928")}</button></form>
      </section>

      {/* Web Push */}
      <h2 className="mb-2 mt-8 text-xs font-medium text-[var(--fg-dim)]">{_t(_locale, "settings.md7e3dc650e")}</h2>
      <div className="panel p-4">
        <PushButton />
        <p className="mt-3 text-xs text-[var(--fg-dim)]">
          {_t(_locale, "settings.m070de94138")}</p>
      </div>

      {/* Status der Zustellwege */}
      <div className="mt-6 flex gap-4 text-xs text-[var(--fg-dim)]">
        <span>
          <span className="led mr-1.5 inline-block align-middle" style={{ background: emailVia ? "var(--up)" : "var(--unknown)" }} />
          {_t(_locale, "settings.mce9e3029f8")}{emailVia ? _t(_locale, "settings.m634dd9fb2a", { value0: emailVia }) : _t(_locale, "settings.mcb2dd803eb")}
        </span>
        <span>
          <span className="led mr-1.5 inline-block align-middle" style={{ background: vapidOk ? "var(--up)" : "var(--unknown)" }} />
          {_t(_locale, "settings.m37f6b890a0")}{vapidOk ? _t(_locale, "common.configured") : _t(_locale, "settings.mcb2dd803eb")}
        </span>
      </div>
    </>
  );
}
