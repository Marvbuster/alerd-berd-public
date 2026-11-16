import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { SettingsNavigation } from "@/components/SettingsNavigation";
import { requireUser } from "@/lib/auth";

// Ein Ort für alles, was einmal eingerichtet wird: Benachrichtigungen,
// Zugänge zu Coolify, GitHub und Claude, API-Schlüssel und für Admins die
// Benutzerverwaltung. Die Hauptnavigation bleibt damit beim Tagesgeschäft.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const _locale = await _getLocale();
  const user = await requireUser();
  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-7">
    <PageHeader title={_t(_locale, "settings.mf5750a5d72")} description={_t(_locale, "settings.mbc3922b54d")} icon="settings" />
    <SettingsNavigation admin={user.role === "ADMIN"} />
    {children}
  </main>;
}
