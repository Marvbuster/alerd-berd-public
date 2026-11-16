// Einmal täglich fasst Alerd reife, wirklich auswählbare Dependency-Updates
// zusammen. Der Scheduler kann diese Funktion mehrfach aufrufen: die DB-Unique
// Constraint macht jeden Versand pro Kanal und Berliner Tag idempotent.

import { prisma } from "@/lib/prisma";
import { sendToChannel } from "@/lib/alert";
import { loadServices } from "@/lib/services";
import { majorIssuesLine } from "@/lib/major-issues";
import { publicUrl } from "@/lib/public-url";

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

const kindLabel = (p: DigestPkg) => p.recommended ? `Major, ${p.hold ? "abwarten" : "empfohlen"}: ${p.recommended}` : null;
const serviceList = (g: DigestGroup) => g.services.map((s) => s.from === g.from ? s.service : `${s.service} (von ${s.from || "?"})`).join(", ");

function textPkg(p: DigestPkg, from: string) {
  const kind = kindLabel(p);
  return `  • ${p.name}: ${from || "?"} → ${p.to}${p.security ? " (Sicherheit)" : p.minor ? " (Minor)" : ""}${kind ? ` (${kind})` : ""}${p.issues ? `\n      ${p.issues}${p.issuesUrl ? `: ${p.issuesUrl}` : ""}` : ""}${(p.known ?? []).map((k) => `\n      Bekanntes Problem: ${k}`).join("")}`;
}

function textDigest(items: DigestItem[]) {
  if (!items.length) return "AlerdReperd\n\nGuten Morgen! Für deine Dienste sind heute keine reifen Paket-Updates offen.\n\nAlerd Berd";
  const { shared, single } = groupDigest(items);
  return ["AlerdReperd", "", "Guten Morgen! Diese Dependency-Updates sind bereit zur Prüfung:", "",
    ...(shared.length ? ["In mehreren Diensten", ...shared.flatMap((g) => [textPkg(g.pkg, g.from), `      In ${g.services.length} Diensten: ${serviceList(g)}`]), ""] : []),
    ...single.flatMap((item) => [item.service, ...item.packages.map((p) => textPkg(p, p.from)), ""]),
    "", `Öffne Alerd Berd, um die Analyse zu starten: ${PUBLIC_URL}/services`, "Jeder Commit und Push braucht weiterhin deine Freigabe.", "", "Alerd Berd"].join("\n");
}

function esc(value: string) { return value.replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c); }

// Farben wie in der App (globals.css): dunkles Blau, Cyan als Akzent.
const C = { bg: "#102035", panel: "#192d44", line: "#3b536e", fg: "#edf4fc", dim: "#b1c3d9", cyan: "#51dcea", red: "#ff8b93" };

// Wortmarke wie im Kopf der App: erster Teil fett, zweiter schmal und gedimmt.
function wordmark(bold: string, light: string, size: number) {
  return `<span style="font-size:${size}px;font-weight:800;letter-spacing:-0.5px;color:${C.fg}">${bold}<span style="font-weight:400;color:${C.dim}">${light}</span></span>`;
}

function htmlPkg(p: DigestPkg, from: string, extra = "") {
  const kind = kindLabel(p);
  return `<div style="margin-top:7px;color:${C.dim};font-size:14px"><code style="color:${C.fg};font-family:Menlo,Consolas,monospace">${esc(p.name)}</code> &nbsp;${esc(from || "?")} → <strong style="color:${C.cyan}">${esc(p.to)}</strong>${p.security ? ` &nbsp;<span style="color:${C.red};border:1px solid ${C.red};border-radius:6px;padding:1px 6px;font-size:11px">Sicherheit</span>` : p.minor ? ` &nbsp;<span style="color:${C.dim};border:1px solid ${C.line};border-radius:6px;padding:1px 6px;font-size:11px">Minor</span>` : ""}${kind ? `<div style="margin-top:3px;color:${p.hold ? C.red : C.dim};font-size:13px">${esc(kind)}</div>` : ""}${p.issues ? `<div style="margin-top:3px;font-size:13px">${p.issuesUrl ? `<a href="${esc(p.issuesUrl)}" style="color:${C.dim}">${esc(p.issues)}</a>` : `<span style="color:${C.dim}">${esc(p.issues)}</span>`}</div>` : ""}${(p.known ?? []).map((k) => `<div style="margin-top:3px;color:${C.red};font-size:13px">Bekanntes Problem: ${esc(k)}</div>`).join("")}${extra}</div>`;
}

export function htmlDigest(items: DigestItem[], now: Date) {
  const day = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now);
  const count = items.reduce((total, item) => total + item.packages.length, 0);
  const { shared, single } = groupDigest(items);
  const block = (head: string, body: string) => `<tr><td style="padding:18px 24px;border-top:1px solid ${C.line}"><strong style="color:${C.fg};font-size:15px">${head}</strong>${body}</td></tr>`;
  const rows = items.length
    ? (shared.length ? block("In mehreren Diensten", shared.map((g) => htmlPkg(g.pkg, g.from, `<div style="margin-top:3px;color:${C.fg};font-size:13px">In ${g.services.length} Diensten: ${esc(serviceList(g))}</div>`)).join("")) : "")
      + single.map((item) => block(esc(item.service), item.packages.map((p) => htmlPkg(p, p.from)).join(""))).join("")
    : `<tr><td style="padding:28px 24px;border-top:1px solid ${C.line};color:${C.dim}">Keine reifen Paket-Updates offen. Schön ruhig heute.</td></tr>`;
  return `<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:${C.fg}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.bg}"><tr><td style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:${C.panel};border:1px solid ${C.line};border-radius:16px;overflow:hidden">
<tr><td style="padding:28px 24px 22px"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:middle;padding-right:12px"><img src="${PUBLIC_URL}/alerd-logo.png" width="56" height="56" alt="" style="display:block;border:0"></td><td style="vertical-align:middle">${wordmark("Alerd", "Reperd", 30)}</td></tr></table>
<p style="margin:16px 0 0;font-size:17px;font-weight:700;color:${C.fg}">Deine Updates für ${esc(day)}</p><p style="margin:4px 0 0;color:${C.dim};font-size:14px">${items.length ? `${count} Paket${count === 1 ? "" : "e"} in ${items.length} Dienst${items.length === 1 ? "" : "en"}` : "Alles aktuell"}</p></td></tr>
${rows}
<tr><td style="padding:22px 24px;border-top:1px solid ${C.line}"><a href="${PUBLIC_URL}/services" style="display:inline-block;background:${C.cyan};color:#09212b;font-weight:700;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:10px">Dienste öffnen</a><p style="margin:16px 0 0;color:${C.dim};font-size:13px;line-height:1.5">Alerd aktualisiert nie automatisch: Analyse, Vorbereitung sowie Commit &amp; Push bleiben einzeln freigegeben.</p></td></tr>
</table><p style="max-width:620px;margin:16px auto 0;text-align:center">${wordmark("Alerd", "Berd", 14)}</p></td></tr></table></body></html>`;
}

export async function sendDueDailyUpdateDigests(now = new Date()): Promise<{ sent: number; skipped: boolean }> {
  const when = berlin(now);
  // Ab 08:00 verschicken wir beim ersten erfolgreichen Scheduler-Lauf. Das ist
  // robuster als ein enges Minutenfenster bei Deploys oder kurzen Ausfällen.
  if (when.hour < 8) return { sent: 0, skipped: true };
  const owners = await prisma.user.findMany({ where: { active: true, dailyUpdateDigest: true, channels: { some: { enabled: true, kind: "EMAIL" } } }, select: { id: true, channels: { where: { enabled: true, kind: "EMAIL" } } } });
  let sent = 0;
  for (const owner of owners) {
    // Erst prüfen, ob heute schon alles erledigt ist. Sonst liefe die teure
    // Dienste-Sicht ab 8 Uhr bei jedem Check-Lauf für jeden Nutzer.
    const done = await prisma.dailyUpdateDigest.findMany({ where: { ownerId: owner.id, day: when.day }, select: { channelId: true } });
    const open = owner.channels.filter((channel) => !done.some((d) => d.channelId === channel.id));
    if (!open.length) continue;
    const { services } = await loadServices(owner.id, now);
    const items: DigestItem[] = services.map((service) => ({ service: service.name, packages: service.candidates.map((candidate) => ({ name: candidate.name, from: candidate.from, to: candidate.to, security: candidate.security || candidate.critical, minor: candidate.jump === "minor", recommended: candidate.recommended?.title, hold: candidate.recommended?.hold,
      issues: candidate.recommended?.issues ? majorIssuesLine(candidate.recommended.issues) : undefined, issuesUrl: candidate.recommended?.issues?.searchUrl,
      known: candidate.knownIssues?.map((k) => k.title) })) })).filter((item) => item.packages.length);
    // Nichts offen: keine Mail, aber für heute vermerken, damit nicht erneut gerechnet wird.
    if (!items.length) {
      await prisma.dailyUpdateDigest.createMany({ data: open.map((channel) => ({ ownerId: owner.id, channelId: channel.id, day: when.day, success: true, detail: "nichts offen, keine Mail" })), skipDuplicates: true });
      continue;
    }
    const subject = items.length ? `AlerdReperd: ${items.reduce((total, item) => total + item.packages.length, 0)} Paket-Update${items.reduce((total, item) => total + item.packages.length, 0) === 1 ? "" : "s"} bereit` : "AlerdReperd: keine Paket-Updates offen";
    const text = textDigest(items), html = htmlDigest(items, now);
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
