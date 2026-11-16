import { createHash } from "node:crypto";
import { githubRepository, parseNpmManifest, repositoryBranch, repositoryFile } from "./repository-logic";
import { parseGitHubExpiration } from "./credential-expiry";

async function get(path: string, token: string | null, raw = false): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method: "GET", headers: {
        accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "x-github-api-version": "2022-11-28", "user-agent": "alerd-board",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("GitHub nicht erreichbar (Timeout, Netzwerk oder Weiterleitung)."); }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 404) throw new Error("GitHub HTTP 404: Repo, Branch oder Datei fehlt oder ist für den Token nicht lesbar.");
    if (res.status === 401) throw new Error("GitHub HTTP 401: Token ungültig oder abgelaufen.");
    if (res.status === 403 || res.status === 429) throw new Error(`GitHub HTTP ${res.status}: Contents-Leserechte, Token-Freigabe und Rate-Limit prüfen.`);
    throw new Error(`GitHub HTTP ${res.status}.`);
  }
  if (!res.body) throw new Error("GitHub liefert keine Daten.");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > (raw ? 8_000_000 : 512_000)) throw new Error("GitHub-Datei überschreitet das Größenlimit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("GitHub-Datei enthält kein gültiges JSON."); }
}

export async function fetchRepositoryDependencies(config: { repository: string; branch: string; manifestPath: string; lockfilePath: string }, token: string | null) {
  const repo = githubRepository(config.repository).split("/").map(encodeURIComponent).join("/");
  const branch = repositoryBranch(config.branch);
  const manifestPath = repositoryFile(config.manifestPath, "package.json");
  const lockfilePath = repositoryFile(config.lockfilePath, "package-lock.json");
  const ref = json(await get(`/repos/${repo}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, token)) as { ref?: string; object?: { type?: string; sha?: string } } | null;
  const sha = ref?.object?.sha;
  if (ref?.ref !== `refs/heads/${branch}` || ref?.object?.type !== "commit" || typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("GitHub liefert keinen eindeutigen Branch-Commit.");
  const path = (file: string) => `/repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`;
  const [manifest, lockfile] = await Promise.all([get(path(manifestPath), token, true), get(path(lockfilePath), token, true)]);
  const parsed = parseNpmManifest(json(manifest), json(lockfile), manifestPath, lockfilePath);
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  return { commitSha: sha, ...parsed, manifestHash: hash(manifest), lockfileHash: hash(lockfile) };
}

// Ablauf eines Tokens: GitHub nennt ihn bei jedem Aufruf im Header
// github-authentication-token-expiration. /rate_limit zählt nicht aufs Limit.
// valid false bei 401. expiresAt null heißt: Token läuft nicht ab.
export async function fetchGitHubTokenExpiry(token: string): Promise<{ valid: boolean; expiresAt: Date | null }> {
  const res = await fetch("https://api.github.com/rate_limit", {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "alerd-board", authorization: `Bearer ${token}` },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  await res.body?.cancel();
  if (res.status === 401) return { valid: false, expiresAt: null };
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return { valid: true, expiresAt: parseGitHubExpiration(res.headers.get("github-authentication-token-expiration")) };
}
