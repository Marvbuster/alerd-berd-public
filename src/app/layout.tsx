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

export const metadata: Metadata = {
  title: "Alerd Berd",
  description:
    "Überwacht Dienste (Health-Checks) und alarmiert per E-Mail und Push, wenn etwas ausfällt.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Alerd" },
  icons: { icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

export const viewport: Viewport = {
  themeColor: "#102035",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const notifications = user ? await loadDependencyNotifications(user.id).catch(() => []) : [];
  return (
    <html lang="de">
      <body className="min-h-screen antialiased">
        <a href="#main-content" className="skip-link">Zum Inhalt</a>
        <StickyTopbar><div className="app-topbar-inner">
          <Link href="/" className="app-brand"><AlerdLogo size={42} className="mr-1" />Alerd<span className="font-normal text-[var(--fg-dim)]">Berd</span></Link>
          <div className="app-account"><span className="hidden sm:inline"><Clock /></span>{user && <><span className="hidden md:inline">{user.name || user.email}</span><NotificationHub initial={notifications} /><SettingsLink /><form action={logout}><button type="submit" className="icon-button" title="Abmelden" aria-label="Abmelden"><Icon name="logout" size={18} /></button></form></>}</div>
        </div>{user && <AppNavigation />}</StickyTopbar>
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
