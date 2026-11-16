export const LOCALES = ["de", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "alerd-locale";
export const LOCALE_HEADER = "x-alerd-locale";

export function asLocale(value: unknown): Locale | null {
  return value === "de" || value === "en" ? value : null;
}

export function defaultLocale(value = process.env.ALERD_DEFAULT_LOCALE): Locale {
  return asLocale(value) ?? "en";
}

export function acceptedLocale(header: string | null | undefined): Locale | null {
  return (header ?? "").split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find(p => p.trim().startsWith("q="));
      return { locale: asLocale(tag.toLowerCase().split("-")[0]), q: quality ? Number(quality.trim().slice(2)) : 1, index };
    })
    .filter(entry => entry.locale && Number.isFinite(entry.q) && entry.q > 0 && entry.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.locale ?? null;
}

export function resolveLocale({ cookie, user, acceptLanguage, fallback }: {
  cookie?: unknown; user?: unknown; acceptLanguage?: string | null; fallback?: string;
} = {}): Locale {
  return asLocale(cookie) ?? asLocale(user) ?? acceptedLocale(acceptLanguage) ?? defaultLocale(fallback);
}

export function intlLocale(locale: string): string { return locale === "de" ? "de-DE" : "en-GB"; }

export function utcDateTime(value: Date, locale: string): string {
  return value.toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
}
