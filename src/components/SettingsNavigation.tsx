"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

import Link from "next/link";
import { usePathname } from "next/navigation";

function sections(_locale: string = "de") { return ([
  { href: "/settings", label: _t(_locale, "SettingsNavigation.mf7205df4f1") },
  { href: "/settings/access", label: _t(_locale, "SettingsNavigation.mf458711710") },
  { href: "/settings/keys", label: _t(_locale, "SettingsNavigation.mde526edf81") },
]); }

export function SettingsNavigation({ admin }: { admin: boolean }) {
  const _locale = _useLocale();
  const pathname = usePathname();
  const entries = admin ? [...sections(_locale), { href: "/settings/users", label: _t(_locale, "SettingsNavigation.m80033f8258") }] : sections(_locale);
  return <nav className="settings-navigation" aria-label={_t(_locale, "SettingsNavigation.mf5750a5d72")}>{entries.map(({ href, label }) => {
    const active = href === "/settings" ? pathname === "/settings" : pathname.startsWith(href);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</nav>;
}
