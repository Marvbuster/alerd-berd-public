import { intlLocale } from "@/i18n/locale";

import { translate as _t } from "@/i18n/translate";
import { getLocale as _getLocale } from "next-intl/server";
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

const day = (value: Date, locale = "de") => value.toLocaleDateString(intlLocale(locale));
const since = (value: Date | null | undefined, _locale: string = "de") => value ? _t(_locale, "settings_access.m00f7df12ae", { value0: day(value, _locale) }) : null;

// Ablauf für die Karte. checked false: GitHub noch nicht gefragt, der Check-Runner holt es nach.
function expiry(expiresAt: Date | null | undefined, checked = true, _locale: string = "de"): { text: string | null; warn: boolean } {
  if (!checked) return { text: _t(_locale, "settings_access.ma9c60a3ab2"), warn: false };
  if (!expiresAt) return { text: _t(_locale, "settings_access.m264a5acee6"), warn: false };
  const days = daysLeft(expiresAt);
  return days <= 30 ? { text: `${expiryPhrase(days, _locale)} (${day(expiresAt, _locale)})`, warn: true } : { text: _t(_locale, "settings_access.m90bb962148", { value0: day(expiresAt, _locale) }), warn: false };
}
const meta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

export default async function AccessPage() {
  const _locale = await _getLocale();
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
  const githubExp = github ? expiry(github.expiresAt, !!github.expiryCheckedAt, _locale) : null;
  const publishExp = publish ? expiry(publish.expiresAt, !!publish.expiryCheckedAt, _locale) : null;
  const claudeExp = claude ? expiry(claudeExpiry(claude.connectedAt), true, _locale) : null;
  const coolifyReady = encryption && Boolean(process.env.COOLIFY_ALLOWED_ORIGINS?.trim());

  return <div className="space-y-8">
    {!encryption && <p role="status" className="repository-warning">{_t(_locale, "settings_access.md03e7ec1c0")}</p>}

    <section>
      <h2 className="settings-heading">{_t(_locale, "settings_access.mdf9a9413e0")}</h2>
      <div className="credential-list">
        {connections.map((c) => <CredentialCard key={c.id} title={c.label} icon="layers" configured warn={!!c.lastError} meta={c.lastError ? _t(_locale, "settings_access.mb02c625ce4") : new URL(c.baseUrl).host}
          hint={c.baseUrl} remove={deleteConnection.bind(null, c.id)} removeConfirm={_t(_locale, "settings_access.mad83a048a3", { value0: c.label })}>
          <p className="credential-hint mb-3">{_t(_locale, "settings_access.meaa1a8272b")}</p>
          <ConnectionForm disabled={!coolifyReady} />
        </CredentialCard>)}
        {connections.length === 0
          ? <CredentialCard title={_t(_locale, "settings_access.mdf9a9413e0")} icon="layers" configured={false} hint={_t(_locale, "settings_access.m496646034b")}><ConnectionForm disabled={!coolifyReady} /></CredentialCard>
          : <details className="credential-more"><summary>{_t(_locale, "settings_access.m641ce16afd")}</summary><div className="pt-4"><ConnectionForm disabled={!coolifyReady} /></div></details>}
      </div>
    </section>

    <section>
      <h2 className="settings-heading">{_t(_locale, "settings_access.mf911e414cf")}</h2>
      <div className="credential-list">
        <CredentialCard title={_t(_locale, "settings_access.mdca8f64910")} icon="link" configured={!!github} warn={githubExp?.warn} meta={meta(since(github?.updatedAt, _locale), githubExp?.text)} save={saveGitHubCredential} remove={deleteGitHubCredential}
          removeConfirm={_t(_locale, "settings_access.ma3b3ca5078")} inputLabel={_t(_locale, "settings_access.mfc36e7e8a2")} disabled={!encryption}
          hint={_t(_locale, "settings_access.m04e74ed6b6")} />
        <CredentialCard title={_t(_locale, "settings_access.m69baac0f2d")} icon="arrow" configured={!!publish} warn={publishExp?.warn} meta={meta(since(publish?.updatedAt, _locale), publishExp?.text)} save={saveGitHubPublishCredential} remove={deleteGitHubPublishCredential}
          inputLabel={_t(_locale, "settings_access.m9eca8a820d")} disabled={!encryption}
          hint={_t(_locale, "settings_access.ma124d5fca2")} />
      </div>
    </section>

    <section>
      <h2 className="settings-heading">{_t(_locale, "settings_access.m0615570f9e")}</h2>
      <div className="credential-list">
        <CredentialCard title={_t(_locale, "settings_access.m246ef8c113")} icon="pulse" configured={!!claude} warn={!!claude?.lastError || claudeExp?.warn} meta={claude?.lastError ? _t(_locale, "settings_access.m1ce9c7069b") : meta(since(claude?.connectedAt, _locale), claudeExp?.text)} save={saveClaudeCredential} remove={deleteClaudeCredential}
          inputLabel={_t(_locale, "settings_access.maf735e12b3")} maxLength={8000} disabled={!encryption}
          hint={<>{_t(_locale, "settings_access.mbe155de43a")}<code>{_t(_locale, "settings_access.meac8a87699")}</code> {_t(_locale, "settings_access.m1e9b1f5b0d")}</>} />
      </div>
    </section>

    <section>
      <h2 className="settings-heading">{_t(_locale, "settings_access.md705c6cf5a")}</h2>
      <div className="credential-list">
        <CredentialCard title={_t(_locale, "settings_access.mb7550354bc")} icon="monitor" configured={!!localNode} meta={localNode?.lastSeenAt ? _t(_locale, "settings_access.lastSeen", { name: localNode.nodeName ?? "Node", when: localNode.lastSeenAt.toLocaleString(intlLocale(_locale)) }) : localNode ? _t(_locale, "settings_access.m906b3549f6") : null}
          hint={<>{_t(_locale, "settings_access.me2180340ce")}<Link href="/settings/keys">{_t(_locale, "settings_access.mbdd7303f55")}</Link>.</>}
          remove={deleteLocalAnalysisNode} removeConfirm={_t(_locale, "settings_access.md2b937b66f")}>
          {apiKeys.length ? <form action={saveLocalAnalysisNode} className="credential-form"><label className="sr-only" htmlFor="local-node-key">{_t(_locale, "settings_access.mc260079404")}</label><select id="local-node-key" name="apiKeyId" defaultValue={localNode?.apiKeyId ?? ""}>{!localNode && <option value="" disabled>{_t(_locale, "settings_access.m84d066f7b5")}</option>}{apiKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.prefix}</option>)}</select><button className="btn">{localNode ? _t(_locale, "settings_access.mea5e3417aa") : _t(_locale, "common.setup")}</button></form> : <p className="credential-hint">{_t(_locale, "settings_access.m313639ebef")}<Link href="/settings/keys">{_t(_locale, "settings_access.mf0d66a79c1")}</Link> {_t(_locale, "settings_access.m39d3ed6c57")}</p>}
        </CredentialCard>
      </div>
    </section>
  </div>;
}
