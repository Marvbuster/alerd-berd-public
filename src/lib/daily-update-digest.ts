import { localizedTitle } from "@/i18n/data";

import { translate as _t, recipientLocale } from "../../scripts/i18n.mjs";
// Einmal täglich fasst Alerd reife, wirklich auswählbare Dependency-Updates
// zusammen. Der Scheduler kann diese Funktion mehrfach aufrufen: die DB-Unique
// Constraint macht jeden Versand pro Kanal und Berliner Tag idempotent.

import { prisma } from "@/lib/prisma";
import { sendToChannel } from "@/lib/alert";
import { loadServices } from "@/lib/services";
import { majorIssuesLine } from "@/lib/major-issues";
import { publicUrl } from "@/lib/public-url";
import { intlLocale } from "@/i18n/locale";

const TZ = "Europe/Berlin";

function berlin(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

type DigestItem = { service: string; packages: { name: string; from: string; to: string; security: boolean; minor?: boolean; recommended?: string; hold?: boolean; issues?: string; issuesUrl?: string; known?: string[] }[] };

// Bilder und Links in der Mail brauchen eine absolute Adresse.
const PUBLIC_URL = publicUrl();

type DigestPkg = DigestItem["packages"][number];
export type DigestGroup = { pkg: DigestPkg; from: string; services: { service: string; from: string }[] };

// Dasselbe Update in mehreren Diensten (z. B. eine neue TypeScript-Major) steht
// einmal oben, darunter die Dienste. Nur die Ausgangsversion darf abweichen.
export function groupDigest(items: DigestItem[]): { shared: DigestGroup[]; single: DigestItem[] } {
  const key = (p: DigestPkg) => JSON.stringify([p.name, p.to, p.security, !!p.minor, p.recommended ?? null, !!p.hold, p.issues ?? null, p.known ?? []]);
  const count = new Map<string, number>();
  for (const item of items) for (const p of item.packages) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  const shared = new Map<string, DigestGroup>();
  const single: DigestItem[] = [];
  for (const item of items) {
    const own: DigestPkg[] = [];
    for (const p of item.packages) {
      const k = key(p);
      if ((count.get(k) ?? 0) < 2) { own.push(p); continue; }
      const group = shared.get(k) ?? { pkg: p, from: "", services: [] };
      group.services.push({ service: item.service, from: p.from });
      shared.set(k, group);
    }
    if (own.length) single.push({ service: item.service, packages: own });
  }
  // Häufigste Ausgangsversion in die Kopfzeile, Abweichler stehen beim Dienst.
  for (const group of shared.values()) {
    const tally = new Map<string, number>();
    for (const s of group.services) tally.set(s.from, (tally.get(s.from) ?? 0) + 1);
    group.from = [...tally].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { shared: [...shared.values()], single };
}

const kindLabel = (p: DigestPkg, locale = "de") => p.recommended ? _t(locale, p.hold ? "mail.majorHold" : "mail.majorRecommended", { title: p.recommended }) : null;
const serviceList = (g: DigestGroup, locale = "de") => g.services.map((s) => s.from === g.from ? s.service : _t(locale, "mail.serviceFrom", { name: s.service, from: s.from || "?" })).join(", ");

function textPkg(p: DigestPkg, from: string, _locale: string = "de") {
  const kind = kindLabel(p, _locale);
  return `  • ${p.name}: ${from || "?"} → ${p.to}${p.security ? _t(_locale, "mail.m66de682078") : p.minor ? " (Minor)" : ""}${kind ? ` (${kind})` : ""}${p.issues ? `\n      ${p.issues}${p.issuesUrl ? `: ${p.issuesUrl}` : ""}` : ""}${(p.known ?? []).map((k) => _t(_locale, "mail.mff541979d5", { value0: k })).join("")}`;
}

function textDigest(items: DigestItem[], _locale: string = "de") {
  if (!items.length) return _t(_locale, "mail.me6f7a63c32");
  const { shared, single } = groupDigest(items);
  return [_t(_locale, "mail.m5e3a170e35"), "", _t(_locale, "mail.me82ea33e8b"), "",
    ...(shared.length ? [_t(_locale, "mail.m34b277d816"), ...shared.flatMap((g) => [textPkg(g.pkg, g.from, _locale), _t(_locale, "mail.m3f3b7b014d", { value0: g.services.length, value1: serviceList(g, _locale) })]), ""] : []),
    ...single.flatMap((item) => [item.service, ...item.packages.map((p) => textPkg(p, p.from, _locale)), ""]),
    "", _t(_locale, "mail.mde68cb7681", { value0: PUBLIC_URL }), _t(_locale, "mail.me2ff8f1d55"), "", "Alerd Berd"].join("\n");
}

function esc(value: string) { return value.replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c); }

// Farben wie in der App (globals.css): dunkles Blau, Cyan als Akzent.
const C = { bg: "#102035", panel: "#192d44", line: "#3b536e", fg: "#edf4fc", dim: "#b1c3d9", cyan: "#51dcea", red: "#ff8b93" };

// Wortmarke wie im Kopf der App: erster Teil fett, zweiter schmal und gedimmt.
function wordmark(bold: string, light: string, size: number) {
  return `<span style="font-size:${size}px;font-weight:800;letter-spacing:-0.5px;color:${C.fg}">${bold}<span style="font-weight:400;color:${C.dim}">${light}</span></span>`;
}

function htmlPkg(p: DigestPkg, from: string, extra = "", _locale: string = "de") {
  const kind = kindLabel(p, _locale);
  return `<div style="margin-top:7px;color:${C.dim};font-size:14px"><code style="color:${C.fg};font-family:Menlo,Consolas,monospace">${esc(p.name)}</code> &nbsp;${esc(from || "?")} → <strong style="color:${C.cyan}">${esc(p.to)}</strong>${p.security ? _t(_locale, "mail.ma1d6d52d2c", { value0: C.red, value1: C.red }) : p.minor ? ` &nbsp;<span style="color:${C.dim};border:1px solid ${C.line};border-radius:6px;padding:1px 6px;font-size:11px">Minor</span>` : ""}${kind ? `<div style="margin-top:3px;color:${p.hold ? C.red : C.dim};font-size:13px">${esc(kind)}</div>` : ""}${p.issues ? `<div style="margin-top:3px;font-size:13px">${p.issuesUrl ? `<a href="${esc(p.issuesUrl)}" style="color:${C.dim}">${esc(p.issues)}</a>` : `<span style="color:${C.dim}">${esc(p.issues)}</span>`}</div>` : ""}${(p.known ?? []).map((k) => _t(_locale, "mail.mf9d1c731b2", { value0: C.red, value1: esc(k) })).join("")}${extra}</div>`;
}

export function htmlDigest(items: DigestItem[], now: Date, _locale: string = "de") {
  const day = new Intl.DateTimeFormat(intlLocale(_locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now);
  const count = items.reduce((total, item) => total + item.packages.length, 0);
  const { shared, single } = groupDigest(items);
  const block = (head: string, body: string) => `<tr><td style="padding:18px 24px;border-top:1px solid ${C.line}"><strong style="color:${C.fg};font-size:15px">${head}</strong>${body}</td></tr>`;
  const rows = items.length
    ? (shared.length ? block(_t(_locale, "mail.m34b277d816"), shared.map((g) => htmlPkg(g.pkg, g.from, _t(_locale, "mail.m43bafd1a47", { value0: C.fg, value1: g.services.length, value2: esc(serviceList(g, _locale)) }), _locale)).join("")) : "")
      + single.map((item) => block(esc(item.service), item.packages.map((p) => htmlPkg(p, p.from, "", _locale)).join(""))).join("")
    : _t(_locale, "mail.m33b818db79", { value0: C.line, value1: C.dim });
  return _t(_locale, "mail.m802577e107", { value0: C.bg, value1: C.fg, value2: C.bg, value3: C.panel, value4: C.line, value5: PUBLIC_URL, value6: wordmark("Alerd", "Reperd", 30), value7: C.fg, value8: esc(day), value9: C.dim, value10: items.length ? _t(_locale, "mail.summary", { count, packageSuffix: count === 1 ? "" : _locale === "en" ? "s" : "e", services: items.length, serviceSuffix: items.length === 1 ? "" : _locale === "en" ? "s" : "en" }) : _t(_locale, "mail.allCurrent"), value11: rows, value12: C.line, value13: PUBLIC_URL, value14: C.cyan, value15: C.dim, value16: wordmark("Alerd", "Berd", 14) });
}

export async function sendDueDailyUpdateDigests(now = new Date(), _locale: string = "de"): Promise<{ sent: number; skipped: boolean }> {
  const when = berlin(now);
  // Ab 08:00 verschicken wir beim ersten erfolgreichen Scheduler-Lauf. Das ist
  // robuster als ein enges Minutenfenster bei Deploys oder kurzen Ausfällen.
  if (when.hour < 8) return { sent: 0, skipped: true };
  const owners = await prisma.user.findMany({ where: { active: true, dailyUpdateDigest: true, channels: { some: { enabled: true, kind: "EMAIL" } } }, select: { id: true, locale: true, channels: { where: { enabled: true, kind: "EMAIL" } } } });
  let sent = 0;
  for (const owner of owners) {
    const _locale = recipientLocale(owner.locale);
    // Erst prüfen, ob heute schon alles erledigt ist. Sonst liefe die teure
    // Dienste-Sicht ab 8 Uhr bei jedem Check-Lauf für jeden Nutzer.
    const done = await prisma.dailyUpdateDigest.findMany({ where: { ownerId: owner.id, day: when.day }, select: { channelId: true } });
    const open = owner.channels.filter((channel) => !done.some((d) => d.channelId === channel.id));
    if (!open.length) continue;
    const { services } = await loadServices(owner.id, now);
    const items: DigestItem[] = services.map((service) => ({ service: service.name, packages: service.candidates.map((candidate) => ({ name: candidate.name, from: candidate.from, to: candidate.to, security: candidate.security || candidate.critical, minor: candidate.jump === "minor", recommended: (candidate.recommended ? localizedTitle(candidate.recommended, _locale) : undefined), hold: candidate.recommended?.hold,
      issues: candidate.recommended?.issues ? majorIssuesLine(candidate.recommended.issues, _locale) : undefined, issuesUrl: candidate.recommended?.issues?.searchUrl,
      known: candidate.knownIssues?.map((k) => localizedTitle(k, _locale)) })) })).filter((item) => item.packages.length);
    // Nichts offen: keine Mail, aber für heute vermerken, damit nicht erneut gerechnet wird.
    if (!items.length) {
      await prisma.dailyUpdateDigest.createMany({ data: open.map((channel) => ({ ownerId: owner.id, channelId: channel.id, day: when.day, success: true, detail: "nichts offen, keine Mail" })), skipDuplicates: true });
      continue;
    }
    const subject = items.length ? _t(_locale, "mail.m4af3cfbda3", { value0: items.reduce((total, item) => total + item.packages.length, 0), value1: items.reduce((total, item) => total + item.packages.length, 0) === 1 ? "" : "s" }) : _t(_locale, "mail.mffbbdf3bc0");
    const text = textDigest(items, _locale), html = htmlDigest(items, now, _locale);
    for (const channel of open) {
      try {
        await prisma.dailyUpdateDigest.create({ data: { ownerId: owner.id, channelId: channel.id, day: when.day, success: false } });
      } catch (error) {
        // Unique-Verletzung: heutiger Versand ist bereits protokolliert.
        if ((error as { code?: string }).code === "P2002") continue;
        console.error("[digest] log failed", error); continue;
      }
      const result = await sendToChannel(channel, subject, text, "DAILY_UPDATE", html);
      await prisma.dailyUpdateDigest.update({ where: { ownerId_channelId_day: { ownerId: owner.id, channelId: channel.id, day: when.day } }, data: { success: result.success, detail: result.detail } });
      if (result.success) sent++;
    }
  }
  return { sent, skipped: false };
}
