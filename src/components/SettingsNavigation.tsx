"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/settings", label: "Benachrichtigungen" },
  { href: "/settings/access", label: "Zugänge" },
  { href: "/settings/keys", label: "API-Schlüssel" },
];

export function SettingsNavigation({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const entries = admin ? [...sections, { href: "/settings/users", label: "Benutzer" }] : sections;
  return <nav className="settings-navigation" aria-label="Einstellungen">{entries.map(({ href, label }) => {
    const active = href === "/settings" ? pathname === "/settings" : pathname.startsWith(href);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</nav>;
}
