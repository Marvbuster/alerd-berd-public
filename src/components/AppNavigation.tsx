"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

// Dienste und die Warteschlange des Update-Workers. Einstellungen hängen als
// Zahnrad am Konto.
function links(_locale: string = "de"): { href: string; label: string; icon: IconName }[] { return ([
  { href: "/services", label: _t(_locale, "AppNavigation.ma6f5acc69d"), icon: "grid" },
  { href: "/queue", label: _t(_locale, "AppNavigation.mf0e0c64b1e"), icon: "queue" },
]); }

export function AppNavigation() {
  const _locale = _useLocale();
  const pathname = usePathname();
  return <nav className="app-navigation" aria-label={_t(_locale, "AppNavigation.me8fc666068")}>{links(_locale).map(({ href, label, icon }) => {
    const active = pathname.startsWith(href) || (href === "/services" && pathname.startsWith("/monitors"));
    return <Link href={href} key={href} aria-current={active ? "page" : undefined}><Icon name={icon} size={17} />{label}</Link>;
  })}</nav>;
}

export function SettingsLink() {
  const _locale = _useLocale();
  const pathname = usePathname();
  const active = pathname.startsWith("/settings");
  return <Link href="/settings" className="icon-button" title={_t(_locale, "AppNavigation.mf5750a5d72")} aria-label={_t(_locale, "AppNavigation.mf5750a5d72")} aria-current={active ? "page" : undefined}><Icon name="settings" size={18} /></Link>;
}
