import { messageCode as _code, MessageError as _Error } from "@/i18n/translate";
// Fixed GET endpoint only. No environment, log, command, or deployment access.
export function coolifyBaseUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new _Error("validation.mcf7aaeb824"); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/api/v1', '/api/v1/'].includes(url.pathname)) {
    throw new _Error("validation.m02bb115f7d");
  }
  // Explicit operator allowlist also supports internal Coolify origins. No redirects.
  const allowed = (process.env.COOLIFY_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(url.origin)) throw new _Error("validation.mba1f19f9f4");
  return `${url.origin}/api/v1`;
}

function field(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.length <= max ? value.trim() || null : null;
}

function repository(value: unknown): string | null {
  const raw = field(value);
  if (!raw) return null;
  // Drop credential-bearing URLs entirely rather than persisting secrets.
  if (/^https?:\/\//.test(raw)) {
    try {
      const url = new URL(raw);
      return url.username || url.password || url.search || url.hash ? null : url.toString();
    } catch { return null; }
  }
  return /^(git@[a-z0-9.-]+:)?[a-z0-9_.-]+\/[a-z0-9_./-]+$/i.test(raw) ? raw : null;
}

function origins(list: string): string[] {
  return list.split(",").map((s) => {
    try { const u = new URL(s.trim()); return ["http:", "https:"].includes(u.protocol) ? u.origin : ""; } catch { return ""; }
  }).filter(Boolean);
}

// Docker-Compose-Apps tragen ihre Domains nicht in fqdn, sondern pro Container
// in docker_compose_domains: ein JSON-String (oder Objekt) der Form
// {"matomo": {"domain": "https://a.de,https://b.de"}}.
function composeDomains(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (value.length > 4000) return [];
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!parsed || typeof parsed !== "object") return [];
  return Object.values(parsed as Record<string, unknown>).flatMap((entry) => {
    const domain = entry && typeof entry === "object" ? field((entry as Record<string, unknown>).domain, 2000) : null;
    return domain ? origins(domain) : [];
  });
}

export function parseCoolifyApplications(data: unknown) {
  if (!Array.isArray(data) || data.length > 2000) throw new _Error("validation.m918cf67847");
  const seen = new Set<string>();
  return data.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new _Error("validation.md5dd059560");
    const row = item as Record<string, unknown>;
    const uuid = field(row.uuid, 128);
    const name = field(row.name, 200);
    if (!uuid || !/^[a-z0-9_-]+$/i.test(uuid) || !name || seen.has(uuid)) throw new _Error("validation.m31153059c4");
    seen.add(uuid);
    const sha = field(row.git_commit_sha, 64);
    // Only explicitly selected, non-secret fields survive parsing.
    return {
      uuid, name,
      domains: [...new Set([...origins(field(row.fqdn, 2000) ?? ""), ...composeDomains(row.docker_compose_domains)])].join(", ") || null,
      repository: repository(row.git_repository),
      branch: field(row.git_branch, 200),
      baseDirectory: field(row.base_directory) ?? "/",
      reportedCommit: sha && /^[a-f0-9]{7,64}$/i.test(sha) ? sha : null,
      buildPack: field(row.build_pack, 100),
      status: field(row.status, 100),
    };
  });
}

async function coolifyGet(baseUrl: string, path: string, token: string): Promise<unknown> {
  const base = coolifyBaseUrl(baseUrl);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new _Error("validation.mc856b2fda2"); }
  // Never surface upstream bodies: they can contain secrets or reflect the token.
  if (!response.ok) throw new _Error("validation.m804bb95f93", { value0: response.status });
  if (!response.body) throw new _Error("validation.m98e3f918b5");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4_000_000) throw new _Error("validation.m7ac67ff2c2");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new _Error("validation.m6833ea4d91"); }
  return data;
}

export async function fetchCoolifyApplications(baseUrl: string, token: string) {
  return parseCoolifyApplications(await coolifyGet(baseUrl, "/applications", token));
}

// Nur die Namen der Env-Variablen einer App, Werte werden sofort verworfen.
// Coolify-eigene Variablen und Preview-Duplikate fallen weg.
export function parseCoolifyEnvKeys(data: unknown): string[] {
  if (!Array.isArray(data)) throw new _Error("validation.m2b0041bd76");
  const keys = data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { key, is_preview } = row as { key?: unknown; is_preview?: unknown };
    return typeof key === "string" && is_preview !== true && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key) && !/^(SERVICE_|COOLIFY_)/.test(key) ? [key] : [];
  });
  return [...new Set(keys)].sort();
}

export async function fetchCoolifyEnvKeys(baseUrl: string, token: string, uuid: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uuid)) throw new _Error("validation.m9f22eae99c");
  return parseCoolifyEnvKeys(await coolifyGet(baseUrl, `/applications/${uuid}/envs`, token));
}
