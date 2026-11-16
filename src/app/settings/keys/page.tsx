import { utcDateTime } from "@/i18n/locale";

import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revokeApiKey } from "./actions";
import { NewKeyForm } from "./NewKeyForm";
import { CopyField } from "@/components/CopyField";

export const dynamic = "force-dynamic";

function fmt(d: Date, locale: string): string {
  return utcDateTime(d, locale);
}

export default async function KeysPage() {
  const _locale = await _getLocale();
  const user = await requireUser();
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>

      <p className="mb-4 text-xs text-[var(--fg-dim)]">
        {_t(_locale, "settings_keys.me3fbc5a280")}<code>{_t(_locale, "settings_keys.meec24e5ef8")}</code>{_t(_locale, "settings_keys.mb89fd0c15a")}<code> {_t(_locale, "settings_keys.m5cec7da238")}</code>{_t(_locale, "settings_keys.ma369766455")}<Link href="/llms.txt" className="ml-1 !text-[var(--cyan)]">{_t(_locale, "settings_keys.mf43a9e2f7d")}</Link>.
      </p>

      {keys.length === 0 ? (
        <p className="panel px-4 py-4 text-sm text-[var(--fg-dim)]">{_t(_locale, "settings_keys.m02626c3cb3")}</p>
      ) : (
        <div className="panel divide-y divide-[var(--fg-faint)]">
          {keys.map((k) => {
            const revoked = k.revokedAt != null;
            return (
              <div key={k.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 ${revoked ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    {revoked && <span className="tag">{_t(_locale, "settings_keys.m4b528e7edf")}</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--fg-dim)]">
                    <code className="text-[var(--fg)]">{k.prefix}</code>
                    <span>{_t(_locale, "settings_keys.m8f820ae680")}{fmt(k.createdAt, _locale)}</span>
                    <span>{k.lastUsedAt ? _t(_locale, "settings_keys.mfd4c224141", { value0: fmt(k.lastUsedAt, _locale) }) : _t(_locale, "settings_keys.m58f5c6666d")}</span>
                  </div>
                </div>
                {!revoked && (
                  <div className="flex items-center gap-2">
                    {k.secret && <CopyField value={k.secret} label={_t(_locale, "settings_keys.m4d01478bd3")} />}
                    <form action={revokeApiKey.bind(null, k.id)}>
                      <button type="submit" className="btn btn--ghost !text-[var(--down)]">{_t(_locale, "settings_keys.m4b528e7edf")}</button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <NewKeyForm />
    </>
  );
}
