// Warnt vor ablaufenden Zugängen (GitHub-Tokens, Claude-Code-Token), bevor die
// Versionsüberwachung oder der Update-Worker still scheitert. Läuft mit dem
// Check-Runner, ist aber billig: drei kleine Tabellen, GitHub nur einmal pro Token.
import { prisma } from "./prisma";
import { decryptCredential } from "./credentials";
import { fetchGitHubTokenExpiry } from "./github-client";
import { sendToChannel } from "./alert";
import { claudeExpiry, daysLeft, dueWarning, expiryPhrase } from "./credential-expiry";
import { publicUrl } from "@/lib/public-url";

export type CredentialKind = "github" | "github-publish" | "claude";
export const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  github: "GitHub-Token (Lesen)",
  "github-publish": "GitHub-Token (Schreiben)",
  claude: "Claude-Code-Token",
};

const PUBLIC_URL = publicUrl();

// Beim Speichern und zum Nachtragen: Ablauf bei GitHub abfragen. Ein Token, den
// GitHub ablehnt, gilt als abgelaufen. Netzfehler wirft, dann bleibt
// expiryCheckedAt leer und der nächste Lauf versucht es erneut.
export async function githubExpiryFields(token: string, now = new Date()) {
  const { valid, expiresAt } = await fetchGitHubTokenExpiry(token);
  return { expiresAt: valid ? expiresAt : now, expiryCheckedAt: now, expiryWarnedDays: null };
}

// Für die Speicher-Actions: Ablauf gleich mitspeichern. Ist GitHub nicht
// erreichbar, bleibt expiryCheckedAt leer und der Check-Runner trägt nach.
export async function expiryOrRetry(token: string): Promise<"invalid" | { expiresAt: Date | null; expiryCheckedAt: Date | null; expiryWarnedDays: null }> {
  try {
    const { valid, expiresAt } = await fetchGitHubTokenExpiry(token);
    return valid ? { expiresAt, expiryCheckedAt: new Date(), expiryWarnedDays: null } : "invalid";
  } catch {
    return { expiresAt: null, expiryCheckedAt: null, expiryWarnedDays: null };
  }
}

async function backfillGitHub(ownerId?: string) {
  const own = ownerId ? { ownerId } : {};
  const [read, publish] = await Promise.all([
    prisma.gitHubCredential.findMany({ where: { expiryCheckedAt: null, ...own } }),
    prisma.gitHubPublishCredential.findMany({ where: { expiryCheckedAt: null, ...own } }),
  ]);
  for (const c of read) {
    try {
      const data = await githubExpiryFields(decryptCredential(c.tokenEncrypted, `${c.ownerId}:github`));
      await prisma.gitHubCredential.update({ where: { ownerId: c.ownerId }, data });
    } catch (e) { console.error("[credential-expiry] GitHub (Lesen) nicht prüfbar:", e instanceof Error ? e.message : e); }
  }
  for (const c of publish) {
    try {
      const data = await githubExpiryFields(decryptCredential(c.tokenEncrypted, `${c.ownerId}:github-publish`));
      await prisma.gitHubPublishCredential.update({ where: { ownerId: c.ownerId }, data });
    } catch (e) { console.error("[credential-expiry] GitHub (Schreiben) nicht prüfbar:", e instanceof Error ? e.message : e); }
  }
}

export type Expiry = { ownerId: string; kind: CredentialKind; label: string; expiresAt: Date; warnedDays: number | null };

// Alle Zugänge mit bekanntem Ablauf. GitHub-Tokens ohne Ablauf fehlen hier.
export async function listExpiries(ownerId?: string): Promise<Expiry[]> {
  const own = ownerId ? { ownerId } : {};
  const [read, publish, claude] = await Promise.all([
    prisma.gitHubCredential.findMany({ where: { expiresAt: { not: null }, ...own }, select: { ownerId: true, expiresAt: true, expiryWarnedDays: true } }),
    prisma.gitHubPublishCredential.findMany({ where: { expiresAt: { not: null }, ...own }, select: { ownerId: true, expiresAt: true, expiryWarnedDays: true } }),
    prisma.claudeCredential.findMany({ where: own, select: { ownerId: true, connectedAt: true, expiryWarnedDays: true } }),
  ]);
  const row = (kind: CredentialKind, ownerId: string, expiresAt: Date, warnedDays: number | null): Expiry => ({ ownerId, kind, label: CREDENTIAL_LABEL[kind], expiresAt, warnedDays });
  return [
    ...read.map((c) => row("github", c.ownerId, c.expiresAt!, c.expiryWarnedDays)),
    ...publish.map((c) => row("github-publish", c.ownerId, c.expiresAt!, c.expiryWarnedDays)),
    ...claude.map((c) => row("claude", c.ownerId, claudeExpiry(c.connectedAt), c.expiryWarnedDays)),
  ];
}

async function markWarned(e: Expiry, step: number) {
  const data = { expiryWarnedDays: step };
  if (e.kind === "github") await prisma.gitHubCredential.update({ where: { ownerId: e.ownerId }, data });
  else if (e.kind === "github-publish") await prisma.gitHubPublishCredential.update({ where: { ownerId: e.ownerId }, data });
  else await prisma.claudeCredential.update({ where: { ownerId: e.ownerId }, data });
}

// Schickt je Zugang und Warnstufe (30, 7, 1 Tag, abgelaufen) genau eine Meldung
// an alle aktiven Kanäle des Owners. Scheitern alle Kanäle, kommt sie beim
// nächsten Lauf erneut.
export async function warnExpiringCredentials(ownerId?: string, now = Date.now()) {
  await backfillGitHub(ownerId);
  for (const e of await listExpiries(ownerId)) {
    const days = daysLeft(e.expiresAt, now);
    const step = dueWarning(days, e.warnedDays);
    if (step == null) continue;
    const channels = await prisma.alertChannel.findMany({ where: { ownerId: e.ownerId, enabled: true } });
    const date = e.expiresAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
    const phrase = expiryPhrase(days);
    const subject = `${days < 0 ? "🔴" : "🟠"} ${e.label} ${phrase}`;
    const renew = e.kind === "claude" ? "Mit claude setup-token einen neuen erzeugen" : "Bei GitHub neu erzeugen oder verlängern";
    const text = `Alerd Berd: Dein ${e.label} ${phrase} (${date}). ${renew} und unter Einstellungen → Zugänge eintragen: ${PUBLIC_URL}/settings/access`;
    const results = await Promise.all(channels.map((ch) => sendToChannel(ch, subject, text, days < 0 ? "DOWN" : "DEGRADED")));
    if (!channels.length || results.some((r) => r.success)) await markWarned(e, step);
  }
}
