import { translate as _t } from "@/i18n/translate";
// Ablauf gespeicherter Zugänge, reine Logik. GitHub nennt das Ablaufdatum eines
// Tokens in jeder API-Antwort im Header github-authentication-token-expiration,
// der Claude-Code-Token aus `claude setup-token` gilt ein Jahr.

export const CLAUDE_TOKEN_DAYS = 365;
// Warnstufen in Tagen, von früh nach dringend. 0 heißt: abgelaufen.
export const WARN_STEPS = [30, 7, 1, 0] as const;

const DAY_MS = 86_400_000;

// "2027-01-14 12:00:00 UTC" oder "2026-12-14 09:48:00 -0800" → Date.
export function parseGitHubExpiration(header: string | null | undefined): Date | null {
  const m = header?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const zone = !m[3] || m[3] === "UTC" || m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function claudeExpiry(connectedAt: Date): Date {
  return new Date(connectedAt.getTime() + CLAUDE_TOKEN_DAYS * DAY_MS);
}

// Ganze Tage bis zum Ablauf, abgerundet. Negativ heißt: schon abgelaufen.
export function daysLeft(expiresAt: Date, now = Date.now()): number {
  return Math.floor((expiresAt.getTime() - now) / DAY_MS);
}

// Welche Warnstufe ist fällig? Die dringendste erreichte Stufe, aber nur, wenn
// sie dringender ist als die schon gemeldete. Sonst null.
export function dueWarning(days: number, warnedDays: number | null): number | null {
  const reached = WARN_STEPS.filter((step) => days <= step);
  if (!reached.length) return null;
  const step = Math.min(...reached);
  return warnedDays == null || step < warnedDays ? step : null;
}

export function expiryPhrase(days: number, _locale: string = "de"): string {
  if (days < 0) return _t(_locale, "credential_expiry.mcf0bc21df6");
  if (days === 0) return _t(_locale, "credential_expiry.m7fc0c3ff19");
  if (days === 1) return _t(_locale, "credential_expiry.me477a24ba9");
  return _t(_locale, "credential_expiry.m15fdab428c", { value0: days });
}

export type ExpiringCredential = { label: string; expiresAt: Date };

// Der Zugang, der als Nächstes abläuft, für Spec-Health und Anzeige.
export function soonest<T extends ExpiringCredential>(list: T[]): T | null {
  return list.reduce<T | null>((best, c) => (!best || c.expiresAt < best.expiresAt ? c : best), null);
}
