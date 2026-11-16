import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { credentialsConfigured } from "@/lib/credentials";
import { claudeExpiry, daysLeft, expiryPhrase } from "@/lib/credential-expiry";
import { CredentialCard } from "@/components/CredentialCard";
import { ConnectionForm } from "@/components/CoolifyForms";
import { deleteConnection } from "@/app/coolify/actions";
import { deleteGitHubCredential, saveGitHubCredential } from "@/app/coolify/repository-actions";
import { deleteClaudeCredential, deleteGitHubPublishCredential, deleteLocalAnalysisNode, saveClaudeCredential, saveGitHubPublishCredential, saveLocalAnalysisNode } from "@/app/coolify/dependency-actions";

export const dynamic = "force-dynamic";

const day = (value: Date) => value.toISOString().slice(0, 10).split("-").reverse().join(".");
const since = (value: Date | null | undefined) => value ? `seit ${day(value)}` : null;

// Ablauf für die Karte. checked false: GitHub noch nicht gefragt, der Check-Runner holt es nach.
function expiry(expiresAt: Date | null | undefined, checked = true): { text: string | null; warn: boolean } {
  if (!checked) return { text: "Ablauf wird geprüft", warn: false };
  if (!expiresAt) return { text: "läuft nicht ab", warn: false };
  const days = daysLeft(expiresAt);
  return days <= 30 ? { text: `${expiryPhrase(days)} (${day(expiresAt)})`, warn: true } : { text: `gültig bis ${day(expiresAt)}`, warn: false };
}
const meta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

export default async function AccessPage() {
  const user = await requireUser();
  const [connections, github, publish, claude, localNode, apiKeys] = await Promise.all([
    prisma.coolifyConnection.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, baseUrl: true, lastError: true } }),
    prisma.gitHubCredential.findUnique({ where: { ownerId: user.id }, select: { updatedAt: true, expiresAt: true, expiryCheckedAt: true } }),
    prisma.gitHubPublishCredential.findUnique({ where: { ownerId: user.id }, select: { updatedAt: true, expiresAt: true, expiryCheckedAt: true } }),
    prisma.claudeCredential.findUnique({ where: { ownerId: user.id }, select: { connectedAt: true, lastError: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: user.id }, select: { apiKeyId: true, lastSeenAt: true, nodeName: true, model: true } }),
    prisma.apiKey.findMany({ where: { userId: user.id, revokedAt: null }, select: { id: true, name: true, prefix: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const encryption = credentialsConfigured();
  const githubExp = github ? expiry(github.expiresAt, !!github.expiryCheckedAt) : null;
  const publishExp = publish ? expiry(publish.expiresAt, !!publish.expiryCheckedAt) : null;
  const claudeExp = claude ? expiry(claudeExpiry(claude.connectedAt)) : null;
  const coolifyReady = encryption && Boolean(process.env.COOLIFY_ALLOWED_ORIGINS?.trim());

  return <div className="space-y-8">
    {!encryption && <p role="status" className="repository-warning">CREDENTIAL_ENCRYPTION_KEY fehlt im Container, Zugänge lassen sich erst danach speichern.</p>}

    <section>
      <h2 className="settings-heading">Coolify</h2>
      <div className="credential-list">
        {connections.map((c) => <CredentialCard key={c.id} title={c.label} icon="layers" configured warn={!!c.lastError} meta={c.lastError ? "letzter Import fehlgeschlagen" : new URL(c.baseUrl).host}
          hint={c.baseUrl} remove={deleteConnection.bind(null, c.id)} removeConfirm={`Verbindung „${c.label}“ und importierte Zuordnungen entfernen? Die Monitore bleiben erhalten.`}>
          <p className="credential-hint mb-3">Dieselbe URL erneut speichern, um den Token zu wechseln.</p>
          <ConnectionForm disabled={!coolifyReady} />
        </CredentialCard>)}
        {connections.length === 0
          ? <CredentialCard title="Coolify" icon="layers" configured={false} hint="Read-Token deines Coolify-Teams, daraus entsteht das App-Inventar."><ConnectionForm disabled={!coolifyReady} /></CredentialCard>
          : <details className="credential-more"><summary>Weitere Coolify-Instanz verbinden</summary><div className="pt-4"><ConnectionForm disabled={!coolifyReady} /></div></details>}
      </div>
    </section>

    <section>
      <h2 className="settings-heading">GitHub</h2>
      <div className="credential-list">
        <CredentialCard title="Lesen" icon="link" configured={!!github} warn={githubExp?.warn} meta={meta(since(github?.updatedAt), githubExp?.text)} save={saveGitHubCredential} remove={deleteGitHubCredential}
          removeConfirm="GitHub-Token entfernen? Private Repos können danach nicht mehr gelesen werden." inputLabel="Fine-grained Token, Contents: Read-only" disabled={!encryption}
          hint="Nur für private Repos nötig, öffentliche liest Alerd ohne Token." />
        <CredentialCard title="Schreiben" icon="arrow" configured={!!publish} warn={publishExp?.warn} meta={meta(since(publish?.updatedAt), publishExp?.text)} save={saveGitHubPublishCredential} remove={deleteGitHubPublishCredential}
          inputLabel="Fine-grained Token, Contents: Read and write" disabled={!encryption}
          hint="Wird nur beim freigegebenen Commit & Push eines Updates benutzt." />
      </div>
    </section>

    <section>
      <h2 className="settings-heading">Claude</h2>
      <div className="credential-list">
        <CredentialCard title="Claude Code" icon="pulse" configured={!!claude} warn={!!claude?.lastError || claudeExp?.warn} meta={claude?.lastError ? "letzter Aufruf fehlgeschlagen" : meta(since(claude?.connectedAt), claudeExp?.text)} save={saveClaudeCredential} remove={deleteClaudeCredential}
          inputLabel="Token aus claude setup-token" maxLength={8000} disabled={!encryption}
          hint={<>Auf deinem Rechner <code>claude setup-token</code> ausführen und den Token hier einfügen.</>} />
      </div>
    </section>

    <section>
      <h2 className="settings-heading">Lokale Analyse-Node</h2>
      <div className="credential-list">
        <CredentialCard title="Alerd Node" icon="monitor" configured={!!localNode} meta={localNode?.lastSeenAt ? `${localNode.nodeName ?? "Node"} · zuletzt ${localNode.lastSeenAt.toLocaleString("de-DE")}` : localNode ? "eingerichtet, noch nicht verbunden" : null}
          hint={<>Dein Mac analysiert Update-Kontext lokal über MLX. Build, Commit und Push bleiben immer auf dem Server. <Link href="/settings/keys">Eigenen API-Key anlegen oder kopieren</Link>.</>}
          remove={deleteLocalAnalysisNode} removeConfirm="Lokale Node trennen? Laufende Analysen warten danach, bis du sie auf Claude umstellst.">
          {apiKeys.length ? <form action={saveLocalAnalysisNode} className="credential-form"><label className="sr-only" htmlFor="local-node-key">API-Key der Node</label><select id="local-node-key" name="apiKeyId" defaultValue={localNode?.apiKeyId ?? ""}>{!localNode && <option value="" disabled>API-Key wählen</option>}{apiKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.prefix}</option>)}</select><button className="btn">{localNode ? "Ändern" : "Einrichten"}</button></form> : <p className="credential-hint">Lege zuerst unter <Link href="/settings/keys">Keys</Link> einen persönlichen API-Key an.</p>}
        </CredentialCard>
      </div>
    </section>
  </div>;
}
