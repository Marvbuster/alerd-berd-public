import { translate as _t, recipientLocale } from "../../scripts/i18n.mjs";
// Alerting-Dispatcher: bei Incident-Öffnung (DOWN) / -Auflösung (RECOVERED)
// über alle aktiven AlertChannels benachrichtigen. Idempotent via NotificationLog
// (@@unique([incidentId, channelId, kind])). Ohne Credentials → Dry-Run-Log.

import nodemailer from "nodemailer";
import webpush from "web-push";
import { prisma } from "./prisma";
import type { AlertChannel, AlertEventKind, Incident, Monitor } from "@prisma/client";

function parseFrom(s: string): { email: string; name?: string } {
  const m = s.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: s.trim() };
}

// Brevo Transactional Email API — bevorzugt, wenn Key gesetzt.
async function sendBrevo(to: string, subject: string, text: string, html?: string) {
  const from = parseFrom(process.env.ALERT_FROM || "Alerd Berd <alerts@example.com>");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY as string,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: from.email, name: from.name ?? "Alerd Berd" },
      to: [{ email: to }],
      subject,
      textContent: text,
      ...(html ? { htmlContent: html } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}

function transporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASSWORD } : undefined,
  });
}

let vapidReady = false;
function initVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@example.com", pub, priv);
  vapidReady = true;
  return true;
}

// Web Push mit Klickziel (z. B. Update-Chat), für Meldungen außerhalb von Incidents.
export async function sendWebPushTo(ownerId: string, payload: { title: string; body: string; url: string; tag?: string }) {
  const channels = await prisma.alertChannel.findMany({ where: { ownerId, enabled: true, kind: "WEB_PUSH" } });
  if (!channels.length || !initVapid()) return;
  await Promise.allSettled(channels.map((ch) => webpush.sendNotification(ch.config as unknown as webpush.PushSubscription, JSON.stringify(payload), { TTL: 3600 })));
}

function message(monitor: Monitor, kind: AlertEventKind, _locale: string = "de") {
  const target = monitor.kind === "HEALTH" ? `${monitor.target}${monitor.healthPath ?? "/health"}` : monitor.target;
  if (kind === "DOWN") {
    return {
      subject: _t(_locale, "mail.md93a9f745e", { value0: monitor.name }),
      text: _t(_locale, "mail.m2b62dfd2cc", { value0: monitor.name, value1: monitor.kind, value2: target, value3: new Date().toISOString() }),
    };
  }
  return {
    subject: _t(_locale, "mail.recoveredSubject", { name: monitor.name }),
    text: _t(_locale, "mail.m36ae958236", { value0: monitor.name, value1: target, value2: new Date().toISOString() }),
  };
}

// Ist überhaupt ein Alarm-Transport konfiguriert? (E-Mail via Brevo/SMTP oder
// Web-Push via VAPID.) Ohne das ist der Alerting-Bereich sinnlos → UI blendet ihn aus.
export function alertingConfigured(): boolean {
  const email = Boolean(process.env.BREVO_API_KEY || process.env.SMTP_HOST);
  const push = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  return email || push;
}

// Versand an EINEN Kanal (E-Mail via Brevo/SMTP/Dry-Run, Web Push via VAPID/
// Dry-Run). Wirft nie: Ergebnis kommt als { success, detail } zurück, damit der
// Aufrufer es ins jeweilige Idempotenz-Log schreiben kann.
export async function sendToChannel(
  ch: AlertChannel,
  subject: string,
  text: string,
  pushStatus: string,
  html?: string,
): Promise<{ success: boolean; detail: string | null }> {
  let success = true;
  let detail: string | null = null;
  try {
    if (ch.kind === "EMAIL") {
      const to = (ch.config as { to?: string } | null)?.to;
      if (!to) {
        success = false;
        detail = "keine Adresse";
      } else if (process.env.BREVO_API_KEY) {
        await sendBrevo(to, subject, text, html); // bevorzugt
        detail = "brevo";
      } else {
        const t = transporter();
        if (!t) {
          detail = "dry-run (kein Brevo/SMTP)";
          console.log(`[alert] ${pushStatus} → EMAIL ${to}: ${subject} (dry-run)`);
        } else {
          await t.sendMail({ from: process.env.ALERT_FROM || "Alerd Berd <alerts@example.com>", to, subject, text, ...(html ? { html } : {}) });
        }
      }
    } else if (ch.kind === "WEB_PUSH") {
      if (!initVapid()) {
        detail = "dry-run (keine VAPID-Keys)";
        console.log(`[alert] ${pushStatus} → WEB_PUSH: ${subject} (dry-run)`);
      } else {
        await webpush.sendNotification(
          ch.config as unknown as webpush.PushSubscription,
          JSON.stringify({ title: subject, body: text, status: pushStatus }),
        );
      }
    }
  } catch (e) {
    success = false;
    detail = String(e);
    console.error("[alert] send failed:", e);
  }
  return { success, detail };
}

// Aktive Kanäle des Monitor-Owners (Mandantentrennung). Monitore ohne ownerId
// (dürfte es nach dem Seed-Backfill nicht geben) → keine Kanäle.
export async function ownerChannels(monitor: Pick<Monitor, "ownerId">): Promise<AlertChannel[]> {
  return monitor.ownerId
    ? prisma.alertChannel.findMany({ where: { enabled: true, ownerId: monitor.ownerId } })
    : [];
}

export async function dispatchAlert(monitor: Monitor, incident: Incident, kind: AlertEventKind) {
  const channels = await ownerChannels(monitor);
  const owner = monitor.ownerId ? await prisma.user.findUnique({ where: { id: monitor.ownerId }, select: { locale: true } }) : null;
  const { subject, text } = message(monitor, kind, recipientLocale(owner?.locale));

  for (const ch of channels) {
    const already = await prisma.notificationLog.findFirst({
      where: { incidentId: incident.id, channelId: ch.id, kind },
    });
    if (already) continue;

    const { success, detail } = await sendToChannel(ch, subject, text, kind);
    await prisma.notificationLog.create({
      data: { incidentId: incident.id, channelId: ch.id, kind, success, detail },
    });
  }
}
