"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

// Dienste und die Warteschlange des Update-Workers. Einstellungen hängen als
// Zahnrad am Konto.
const links: { href: string; label: string; icon: IconName }[] = [
  { href: "/services", label: "Dienste", icon: "grid" },
  { href: "/queue", label: "Warteschlange", icon: "queue" },
];

export function AppNavigation() {
  const pathname = usePathname();
  return <nav className="app-navigation" aria-label="Hauptnavigation">{links.map(({ href, label, icon }) => {
    const active = pathname.startsWith(href) || (href === "/services" && pathname.startsWith("/monitors"));
    return <Link href={href} key={href} aria-current={active ? "page" : undefined}><Icon name={icon} size={17} />{label}</Link>;
  })}</nav>;
}

export function SettingsLink() {
  const pathname = usePathname();
  const active = pathname.startsWith("/settings");
  return <Link href="/settings" className="icon-button" title="Einstellungen" aria-label="Einstellungen" aria-current={active ? "page" : undefined}><Icon name="settings" size={18} /></Link>;
}
