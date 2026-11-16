import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Clock } from "@/components/Clock";
import { logout } from "@/app/login/actions";
import { currentUser } from "@/lib/auth";
import { AppNavigation, SettingsLink } from "@/components/AppNavigation";
import { Icon } from "@/components/Icon";
import { AlerdLogo } from "@/components/AlerdLogo";
import { StickyTopbar } from "@/components/StickyTopbar";
import { NotificationHub } from "@/components/NotificationHub";
import { loadDependencyNotifications } from "@/lib/dependency-notifications";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const _locale = await _getLocale();
  return {
  title: "Alerd Berd",
  description:
    _t(_locale, "metadata.description"),
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Alerd" },
  icons: { icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};
}

export const viewport: Viewport = {
  themeColor: "#102035",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const _locale = await _getLocale();
  const user = await currentUser();
  const locale = await getLocale();
  const messages = await getMessages();
  const notifications = user ? await loadDependencyNotifications(user.id, undefined, locale).catch(() => []) : [];
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Berlin">
        <a href="#main-content" className="skip-link">{_t(_locale, "app.mf0521b629c")}</a>
        <StickyTopbar><div className="app-topbar-inner">
          <Link href="/" className="app-brand"><AlerdLogo size={42} className="mr-1" />{_t(_locale, "app.m6810f85490")}<span className="font-normal text-[var(--fg-dim)]">{_t(_locale, "app.m726f5de6d6")}</span></Link>
          <div className="app-account"><span className="hidden sm:inline"><Clock /></span>{user && <><span className="hidden md:inline">{user.name || user.email}</span><NotificationHub initial={notifications} /><SettingsLink /><form action={logout}><button type="submit" className="icon-button" title={_t(_locale, "app.m545f8be33b")} aria-label={_t(_locale, "app.m545f8be33b")}><Icon name="logout" size={18} /></button></form></>}</div>
        </div>{user && <AppNavigation />}</StickyTopbar>
        <div id="main-content">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
