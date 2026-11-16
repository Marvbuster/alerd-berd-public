// Reine Hilfsfunktionen des Dependency-Workers, ohne DB, Env oder Prozesse.
// Getrennt von scripts/dependency-worker.mjs, damit Vitest sie prüfen kann.
import { createHash } from "node:crypto";
import { dirname, relative, isAbsolute } from "node:path";
import semver from "semver";

export function githubUrl(repository) {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/i.test(repository)) throw new Error("Ungültiges GitHub-Repository.");
  return `https://github.com/${repository}.git`;
}

export function gitBranch(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/.test(value) || value.includes("..") || value.endsWith("/") || value.endsWith(".")) {
    throw new Error("Ungültiger Git-Branch.");
  }
  return value;
}

export function commitSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{7,64}$/i.test(value)) throw new Error("Ungültiger Basis-Commit.");
  return value;
}

export function repositoryPath(value, label, filename) {
  if (typeof value !== "string") throw new Error(`${label}-Pfad fehlt.`);
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..") || !(path === filename || path.endsWith(`/${filename}`))) {
    throw new Error(`Ungültiger ${label}-Pfad.`);
  }
  return path;
}

export function safeWatch(watch) {
  return {
    ...watch,
    branch: gitBranch(watch.branch),
    manifestPath: repositoryPath(watch.manifestPath, "Manifest", "package.json"),
    lockfilePath: repositoryPath(watch.lockfilePath, "Lockfile", "package-lock.json"),
  };
}

export function packageDir(watch) {
  const manifestDir = dirname(watch.manifestPath);
  if (dirname(watch.lockfilePath) !== manifestDir) throw new Error("Manifest und Lockfile liegen in unterschiedlichen Verzeichnissen; dieser Job benötigt eine explizite Workspace-Unterstützung.");
  return manifestDir === "." ? "" : manifestDir;
}

export function npmArgs(dir, args) { return dir ? ["--prefix", dir, ...args] : args; }

export function diffHash(diff) { return createHash("sha256").update(diff).digest("hex"); }

// Fremder Repo-Code (npm-Skripte, Build, Tests) und Claude laufen unter eigenen,
// numerischen UIDs pro Job, nie als root. So können sie weder /proc/1/environ
// des Workers (CREDENTIAL_ENCRYPTION_KEY, DATABASE_URL) noch das Git-Verzeichnis
// oder die Claude-Session des jeweils anderen lesen.
export function jobUids(jobId) {
  const slot = parseInt(createHash("sha256").update(String(jobId)).digest("hex").slice(0, 8), 16) % 100_000;
  const build = 200_000 + slot * 2;
  return { build, claude: build + 1 };
}

// Ältere Jobs tragen noch eine feste Modell-ID; der Alias folgt dem jeweils
// aktuellen Opus des Abos und bricht nicht, wenn eine ID ausläuft.
export function modelArg(model) {
  if (typeof model !== "string" || !model || model === "claude-opus-4-8") return "opus";
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(model)) throw new Error("Ungültiges Modell.");
  return model;
}

// Read-only-Werkzeuge plus Web, damit Claude Release Notes und Changelogs
// tatsächlich lesen kann. --restricted entfernt Bash und Co. und ignoriert
// Projekt-Settings aus dem Repo; WebFetch/WebSearch müssen explizit zurück.
export const CLAUDE_TOOLS = "Read,Glob,Grep,WebFetch,WebSearch";

export function claudeArgs({ prompt, model, sessionId }) {
  const args = [
    "-p", prompt,
    "--model", modelArg(model),
    "--output-format", "stream-json", "--verbose",
    "--permission-mode", "plan",
    "--restricted",
    "--tools", CLAUDE_TOOLS,
    "--allowedTools", "WebFetch,WebSearch",
  ];
  if (sessionId) {
    if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) throw new Error("Ungültige Claude-Session.");
    args.push("--resume", sessionId);
  }
  return args;
}

export function parseStream(text) {
  const events = [];
  for (const line of text.split("\n")) { try { events.push(JSON.parse(line)); } catch { /* CLI-Diagnosen ignorieren */ } }
  const assistant = [...events].reverse().find((event) => event?.type === "assistant")?.message?.content;
  const result = [...events].reverse().find((event) => event?.type === "result");
  const textContent = Array.isArray(assistant) ? assistant.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : "";
  const number = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  // Claude Code liefert die Zähler im result-Ereignis. Beide Schreibweisen
  // erlauben, damit ein CLI-Update keine falschen Nullen erzeugt.
  const rawUsage = result?.usage && typeof result.usage === "object" ? result.usage : null;
  const read = (snake, camel) => rawUsage ? number(rawUsage[snake] ?? rawUsage[camel]) : null;
  const inputTokens = read("input_tokens", "inputTokens");
  const outputTokens = read("output_tokens", "outputTokens");
  const cacheReadTokens = read("cache_read_input_tokens", "cacheReadInputTokens");
  const cacheCreationTokens = read("cache_creation_input_tokens", "cacheCreationInputTokens");
  const reported = [inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens].some((value) => value !== null);
  const totalTokens = read("total_tokens", "totalTokens") ?? (reported ? [inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens].reduce((sum, value) => sum + (value ?? 0), 0) : null);
  return {
    sessionId: result?.session_id ?? events.find((event) => event?.session_id)?.session_id ?? null,
    text: textContent || result?.result || "Claude hat keine Textantwort geliefert.",
    usage: {
      reported,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens,
      turns: number(result?.num_turns ?? result?.numTurns),
      durationMs: number(result?.duration_ms ?? result?.durationMs),
    },
  };
}

// package.json darf sich ausschließlich in der next-Version ändern, und zwar
// genau auf die freigegebene Zielversion (optional mit ^ oder ~).
export function validateManifestChange(beforeText, afterText, packageName, targetVersion) {
  return validateManifestChanges(beforeText, afterText, [{ name: packageName, version: targetVersion }]);
}

// Mehrere Pakete in einem Commit: Jedes freigegebene Paket muss genau auf seine
// Zielversion springen, alles andere in package.json bleibt unverändert.
export function validateManifestChanges(beforeText, afterText, list) {
  const before = JSON.parse(beforeText), after = JSON.parse(afterText);
  const sections = new Set(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sections.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`package.json-Feld „${key}“ wurde verändert.`);
  }
  const names = new Set(list.map((p) => p.name));
  const changed = new Set();
  for (const section of sections) {
    const oldRest = { ...(before[section] ?? {}) }, newRest = { ...(after[section] ?? {}) };
    for (const name of names) { delete oldRest[name]; delete newRest[name]; }
    if (JSON.stringify(oldRest) !== JSON.stringify(newRest)) throw new Error(`Unerwartete Dependency-Änderung in ${section}.`);
    for (const { name, version } of list) {
      const oldValue = before[section]?.[name], newValue = after[section]?.[name];
      if (oldValue === newValue) continue;
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (typeof newValue !== "string" || !new RegExp(`^(?:\\^|~)?${escaped}$`).test(newValue)) throw new Error(`${name} wurde nicht auf die freigegebene Zielversion gesetzt.`);
      changed.add(name);
    }
  }
  const missing = list.filter((p) => !changed.has(p.name)).map((p) => p.name);
  if (missing.length) throw new Error(`package.json enthält keine Änderung für ${missing.join(", ")}.`);
}

// Pakete eines Jobs: neue Jobs tragen eine Liste, alte nur packageName/targetVersion.
const NPM_NAME = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export function jobPackages(job) {
  const list = Array.isArray(job.packages) ? job.packages.filter((p) => p && NPM_NAME.test(p.name) && SEMVER.test(p.version)).map((p) => ({ name: p.name, version: p.version, from: typeof p.from === "string" ? p.from : null })) : [];
  return list.length ? list.slice(0, 20) : [{ name: job.packageName, version: job.targetVersion, from: null }];
}

// Kurzname für Überschriften, Push und Commit: „Next 16.4.6“, „jose 6.2.4, zod 4.6.6“, „4 Pakete“.
export function jobLabel(list) {
  const one = (p) => `${p.name === "next" ? "Next" : p.name} ${p.version}`;
  return list.length <= 2 ? list.map(one).join(", ") : `${list.length} Pakete`;
}

// Nach dem Push: Ist die Zielversion live? Grundlage sind die verknüpften
// Monitore, die per Spec-Health runtime.packages melden. Live heißt: jeder
// meldende Monitor zeigt die Zielversion, hat seit dem Push neu gemeldet und
// ist UP oder DEGRADED. Ohne meldenden Monitor lässt sich nichts verifizieren.
export const LIVE_TIMEOUT_MS = 30 * 60_000;
// Beim Deploy laufen alter und neuer Container kurz parallel. Erst wenn die
// Zielversion so lange am Stück gemeldet wird, gilt der Deploy als gesetzt.
export const LIVE_SETTLE_MS = 2 * 60_000;

export function evaluateLive({ targetVersion, publishedAt, now, monitors, timeoutMs = LIVE_TIMEOUT_MS, settleMs = LIVE_SETTLE_MS }) {
  const facts = monitors.filter((m) => m.enabled && m.version).map((m) => ({
    name: m.name, version: m.version, status: m.status,
    fresh: !!m.reportedAt && m.reportedAt > publishedAt,
    firstSeenAt: m.firstSeenAt ?? null,
    incidents: m.incidents ?? 0,
  }));
  if (!facts.length) return { state: "unmonitored", facts };
  const ok = (f) => f.version === targetVersion && f.fresh && (f.status === "UP" || f.status === "DEGRADED");
  const settled = (f) => !f.firstSeenAt || now.getTime() - f.firstSeenAt.getTime() >= settleMs;
  if (facts.every(ok)) return facts.every(settled) ? { state: "live", facts } : { state: "waiting", facts, settling: true };
  if (now.getTime() - publishedAt.getTime() > timeoutMs) {
    const reason = facts.filter((f) => !ok(f)).map((f) => f.version !== targetVersion ? `${f.name} meldet weiter ${f.version}` : !f.fresh ? `${f.name} hat seit dem Push nicht gemeldet` : `${f.name} ist ${f.status}`).join(", ");
    return { state: "timeout", facts, reason: `Nach ${Math.round(timeoutMs / 60_000)} Minuten nicht live: ${reason}.` };
  }
  return { state: "waiting", facts };
}

export function liveFactsText(facts, targetVersion) {
  return facts.map((f) => `- ${f.name}: meldet ${f.version}${f.version === targetVersion ? " (Ziel)" : ""}, Status ${f.status}, ${f.incidents ? `${f.incidents} Incident(s) seit dem Push` : "keine Incidents seit dem Push"}`).join("\n");
}

// Öffentliche Liveness-Route jeder Coolify-Domain (Konvention /api/health).
// Nur https und echte Hostnamen, keine IPs oder localhost, höchstens drei.
export function healthUrls(domains) {
  const urls = [];
  for (const raw of String(domains ?? "").split(/[\s,]+/).filter(Boolean)) {
    let url;
    try { url = new URL(raw.includes("://") ? raw : `https://${raw}`); } catch { continue; }
    const host = url.hostname;
    if (url.protocol !== "https:" || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) continue;
    const target = `${url.origin}/api/health`;
    if (!urls.includes(target)) urls.push(target);
    if (urls.length === 3) break;
  }
  return urls;
}

// Messung des Workers für Claude: Status, relevante Header und die flachen
// JSON-Felder der Antwort. Der Body ist untrusted und wird nur gekürzt zitiert.
export function probeText(probes) {
  if (!probes.length) return "- keine öffentliche Domain mit https gefunden";
  return probes.map((p) => {
    if (p.error) return `- GET ${p.url}: fehlgeschlagen (${p.error})`;
    const fields = p.json && typeof p.json === "object" && !Array.isArray(p.json)
      ? Object.entries(p.json).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).slice(0, 12).map(([k, v]) => `${k}=${String(v).slice(0, 80)}`).join(", ")
      : "kein JSON";
    return `- GET ${p.url} mit Accept-Encoding: gzip → HTTP ${p.status}, content-encoding: ${p.encoding ?? "keins"}, content-type: ${p.type ?? "?"}; Felder: ${fields}`;
  }).join("\n");
}

// Build-Variablen pro Dienst: Platzhalter, mit denen der Build in der Sandbox
// durchläuft. Nie echte Zugangsdaten, die Werte liegen unverschlüsselt in der DB
// und landen im Build fremden Codes. Eine Zeile pro Variable: NAME=wert.
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
// Was die Sandbox selbst steuert oder Code einschleusen könnte, bleibt tabu.
const BLOCKED_ENV = /^(PATH|HOME|USER|SHELL|LANG|LC_.*|CI|NO_COLOR|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|LD_.*|DYLD_.*|NPM_CONFIG_.*|npm_config_.*|GIT_.*|SSH_.*|CLAUDE_.*|ANTHROPIC_.*|CREDENTIAL_ENCRYPTION_KEY|DEPENDENCY_.*)$/i;
export const BUILD_ENV_MAX = 40;

export function parseBuildEnv(text) {
  const env = {};
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length > BUILD_ENV_MAX) throw new Error(`Höchstens ${BUILD_ENV_MAX} Build-Variablen.`);
  for (const line of lines) {
    const eq = line.indexOf("=");
    const name = (eq < 0 ? line : line.slice(0, eq)).trim();
    const value = eq < 0 ? "" : line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!ENV_NAME.test(name)) throw new Error(`Ungültiger Variablenname: ${name.slice(0, 40)}`);
    if (BLOCKED_ENV.test(name)) throw new Error(`${name} setzt Alerd selbst und ist hier nicht erlaubt.`);
    if (value.length > 500) throw new Error(`Wert von ${name} ist zu lang.`);
    env[name] = value;
  }
  return env;
}

// Ein Platzhalter, der zumindest formal passt: URLs parsen, Secrets sind lang genug.
export function placeholderFor(name) {
  const n = name.toUpperCase();
  if (/MONGO/.test(n)) return "mongodb://dummy:dummy@localhost:27017/dummy";
  if (/REDIS/.test(n)) return "redis://localhost:6379";
  if (/(DATABASE|POSTGRES|PG|DB).*(URL|URI)$|^(DATABASE|DB)_(URL|URI)$/.test(n)) return "postgres://dummy:dummy@localhost:5432/dummy";
  if (/(URL|URI|ORIGIN|HOST)$/.test(n)) return "https://example.invalid";
  if (/(SECRET|TOKEN|KEY|PASSWORD|SALT)$/.test(n)) return "dummy-build-placeholder-0123456789abcdef";
  if (/PORT$/.test(n)) return "3000";
  return "dummy";
}

// Namen aus Coolify ergänzen, die noch fehlen. Bestehende Zeilen bleiben.
export function mergeBuildEnvNames(text, names) {
  const current = String(text ?? "").trimEnd();
  const known = new Set(current.split(/\r?\n/).map((l) => l.split("=")[0].trim()).filter(Boolean));
  const added = names.filter((name) => ENV_NAME.test(name) && !BLOCKED_ENV.test(name) && !known.has(name)).map((name) => `${name}=${placeholderFor(name)}`);
  return [current, ...added].filter(Boolean).join("\n");
}

// Web Push für den Update-Chat: nur wenn du dran bist oder der Ablauf endet.
// Ein Text pro Statuswechsel, der Klick öffnet Dienst und Update-Chat.
export function dependencyPushText(status, { appName, label }) {
  const what = label;
  switch (status) {
    case "READY_FOR_REVIEW": return { title: `${appName}: Analyse fertig`, body: `${what} ist analysiert, du bist dran.` };
    case "READY_TO_PUSH": return { title: `${appName}: Update vorbereitet`, body: `${what} ist gebaut und getestet, Commit & Push warten auf dich.` };
    case "FAILED": return { title: `${appName}: Update gescheitert`, body: `${what} ist hängen geblieben, im Update-Chat lässt sich der Schritt wiederholen.` };
    case "DEPLOY_FAILED": return { title: `${appName}: Deploy nicht angekommen`, body: `${what} ist gepusht, aber nicht live gemeldet.` };
    case "LIVE": return { title: `${appName}: Update ist live`, body: `${what} läuft, das Fazit steht im Update-Chat.` };
    case "LIVE_UNVERIFIED": return { title: `${appName}: Update gepusht`, body: `${what} ist gepusht, live prüfen lässt es sich hier nicht.` };
    default: return null;
  }
}

// Release-Tags gibt es als "v1.2.3", "1.2.3" oder in Monorepos als
// "@scope/name@1.2.3". Tags anderer Pakete desselben Monorepos zählen nicht.
export function versionFromTag(tag, name) {
  const raw = String(tag ?? "").trim();
  const at = raw.lastIndexOf("@");
  if (at > 0) return raw.slice(0, at) === name ? semver.valid(raw.slice(at + 1)) : null;
  return semver.valid(raw.replace(/^v/i, ""));
}

// Ohne passende GitHub-Releases bleibt der Changelog: der Abschnitt ab der
// Zielversion bis vor die Ausgangsversion.
export function changelogSection(text, from, to, max = 8_000) {
  if (typeof text !== "string" || !to) return "";
  const lines = text.split("\n");
  const heading = (line, version) => /^#{1,4}\s/.test(line) && new RegExp(`(^|[^\\d.])v?${version.replace(/\./g, "\\.")}(?![\\d.])`).test(line);
  const start = lines.findIndex((line) => heading(line, to));
  if (start < 0) return "";
  let end = lines.length;
  if (from) { const stop = lines.findIndex((line, i) => i > start && heading(line, from)); if (stop > 0) end = stop; }
  return clip(lines.slice(start, end).join("\n"), max).trim();
}

// Art des Sprungs, damit das Modell Patch und Minor nicht verwechselt.
export function bumpKind(from, to) {
  if (!semver.valid(from) || !semver.valid(to)) return "unbekannt";
  const diff = semver.diff(from, to);
  return diff === "patch" || diff === "prepatch" ? "Patch" : diff === "minor" || diff === "preminor" ? "Minor" : diff === "major" || diff === "premajor" ? "Major" : diff ?? "gleich";
}

// Quelltext für die lokale Analyse: die Dateien, die ein Paket importieren,
// bei next zusätzlich Proxy, Config und Route-Handler. Gezählt wird über
// Import-Spezifizierer statt über den bloßen Namen, damit "react" nicht jede
// Datei mit dem Wort trifft.
export function importPatterns(name) {
  const specs = ['"', "'"].flatMap((q) => [`${q}${name}${q}`, `${q}${name}/`]);
  return specs.flatMap((spec) => [`from ${spec}`, `import ${spec}`, `require(${spec}`, `import(${spec}`]);
}

const SKIP_SOURCE = /(^|\/)(node_modules|dist|build|out|coverage|\.next|vendor)\/|(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|CHANGELOG\.md)$|\.(min\.js|map|snap)$|(^|\/)(__tests__|__mocks__|tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

export function parseGrepCounts(stdout) {
  return String(stdout ?? "").split("\n").map((line) => {
    const at = line.lastIndexOf(":");
    const count = Number(line.slice(at + 1));
    return at > 0 && Number.isFinite(count) && count > 0 ? { path: line.slice(0, at), count } : null;
  }).filter((x) => !!x);
}

// Proxy und Config zuerst, dann die Route-Handler.
export function nextRelevantFiles(paths) {
  const rank = (p) => /(^|\/)(proxy|middleware|next\.config)\./.test(p) ? 0 : 1;
  return paths.filter((p) => !SKIP_SOURCE.test(p) && (/(^|\/)(proxy|middleware)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)next\.config\.[cm]?[jt]s$/.test(p) || /(^|\/)app\/(.*\/)?route\.[cm]?[jt]sx?$/.test(p))).sort((a, b) => rank(a) - rank(b));
}

// Abwechselnd pro Paket die meistgenutzten Dateien, damit ein großes Paket
// die kleinen nicht verdrängt. Eine Datei für mehrere Pakete zählt einmal.
export function pickSourceFiles(groups, maxFiles = 10) {
  const queues = groups.map((g) => ({ pkg: g.pkg, files: g.files.filter((f) => f.path && !f.path.startsWith("/") && !f.path.split("/").includes("..") && !SKIP_SOURCE.test(f.path)).sort((a, b) => b.count - a.count) }));
  const picked = new Map();
  for (let round = 0; picked.size < maxFiles && queues.some((q) => q.files.length > round); round++) {
    for (const q of queues) {
      const file = q.files[round];
      if (!file) continue;
      const entry = picked.get(file.path);
      if (entry) { if (!entry.includes(q.pkg)) entry.push(q.pkg); continue; }
      if (picked.size >= maxFiles) break;
      picked.set(file.path, [q.pkg]);
    }
  }
  return [...picked].map(([path, pkgs]) => ({ path, pkgs }));
}

// @types/x beschreibt das Paket x, importiert wird im Code also x.
// @types/scope__name gehört zu @scope/name. @types/node hat keinen
// eindeutigen Import (fs, node:fs, …) und bleibt außen vor.
export function typesTarget(name) {
  if (typeof name !== "string" || !name.startsWith("@types/")) return null;
  const bare = name.slice("@types/".length);
  if (!bare || bare === "node") return null;
  return bare.includes("__") ? `@${bare.replace("__", "/")}` : bare;
}

// Aus zwei jsDelivr-Dateilisten die Typdateien, die sich geändert haben.
// Kleine Dateien zuerst, damit ein großes Paket wie @types/react nicht nur
// eine riesige Datei zeigt.
export function changedTypeFiles(fromFiles, toFiles, max = 8) {
  const isTypes = (f) => typeof f?.name === "string" && /\.d\.[cm]?ts$/.test(f.name) && !f.name.split("/").includes("..");
  const before = new Map((fromFiles ?? []).filter(isTypes).map((f) => [f.name, f]));
  const after = new Map((toFiles ?? []).filter(isTypes).map((f) => [f.name, f]));
  const changed = [], seen = new Set();
  for (const [name, f] of after) {
    const old = before.get(name);
    if (!old) changed.push({ name, status: "neu", size: f.size ?? 0 });
    else if (old.hash !== f.hash) {
      // Gleicher Inhalt unter zwei Namen (index.d.ts und browser.d.ts) zählt einmal.
      const pair = `${old.hash}>${f.hash}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      changed.push({ name, status: "geändert", size: Math.max(f.size ?? 0, old.size ?? 0) });
    }
  }
  for (const [name, f] of before) if (!after.has(name)) changed.push({ name, status: "entfernt", size: f.size ?? 0 });
  return { total: changed.length, files: changed.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name)).slice(0, max) };
}

// Hinweis zu einer roten Ausgangslage. Fehlende Dateien sind kein Env-Problem:
// Liegt die Datei außerhalb des Repos (Nachbar-Ordner im Workspace), fehlt sie in
// Alerds Einzel-Klon. Liegt sie im Repo, ist sie nicht eingecheckt.
// Welche npm-Skripte der Worker in der Sandbox ausführt. Hat das Repo eigene
// Skripte mit Präfix alerd: (alerd:typecheck, alerd:build, alerd:test), laufen
// nur die, so wie sie dastehen: Das Repo legt selbst fest, was Alerd ausführen
// darf. Sonst die üblichen typecheck, build und test, dabei aber ohne
// Browser-Tests (Cypress, Playwright & Co.). Die brauchen Browser, Xvfb und eine
// laufende App, die es in der Sandbox nicht gibt. Unit-Tests laufen.
export const SANDBOX_STEPS = ["typecheck", "build", "test"];
export const ALERD_PREFIX = "alerd:";
const BROWSER_TEST = /\b(cypress\s+(run|open)|playwright\s+test|start-server-and-test|testcafe|wdio|nightwatch)\b/;
export function sandboxScripts(scripts) {
  if (!scripts || typeof scripts !== "object") return [];
  const has = (name) => typeof scripts[name] === "string";
  const own = SANDBOX_STEPS.map((step) => `${ALERD_PREFIX}${step}`).filter(has);
  if (own.length) return own;
  return SANDBOX_STEPS.filter((name) => has(name) && !BROWSER_TEST.test(scripts[name]));
}

// Prisma ab 7 erzeugt den Client nicht mehr beim npm ci, das steht nur im
// Dockerfile (RUN npx prisma generate). Ohne Client scheitert der Typecheck an
// PrismaClient. Gilt für Repos mit Prisma-CLI und Schema bzw. prisma.config.
export const PRISMA_SCHEMA_PATHS = ["prisma.config.ts", "prisma.config.mts", "prisma.config.mjs", "prisma.config.js", "prisma/schema.prisma", "prisma/schema"];
export function prismaSchemaPaths(pkg) {
  const custom = typeof pkg?.prisma?.schema === "string" ? [pkg.prisma.schema] : [];
  return [...PRISMA_SCHEMA_PATHS, ...custom];
}
export function needsPrismaGenerate(pkg, existing) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  return typeof deps.prisma === "string" && prismaSchemaPaths(pkg).some((path) => existing.has(path));
}

export function baselineHint(output, repoDir) {
  const paths = [...new Set([...String(output).matchAll(/ENOENT: no such file or directory, (?:open|stat|scandir|lstat) '([^']+)'/g)].map((m) => m[1]))];
  const rel = (p) => relative(repoDir, p);
  const outside = paths.find((p) => { const r = rel(p); return r.startsWith("..") || isAbsolute(r); });
  if (outside) return `Ein Test liest ${rel(outside)}, das liegt außerhalb des Repos. Alerd klont nur dieses Repo, Dateien aus Nachbar-Ordnern fehlen in der Sandbox. Im Repo den Test überspringen lassen, wenn die Datei fehlt.`;
  if (paths.length) return `Die Datei ${rel(paths[0])} fehlt im Git-Stand, vielleicht steht sie in .gitignore oder wird lokal erzeugt.`;
  if (/Xvfb|cypress|playwright/i.test(String(output))) return "Ein Browser-Test läuft in der Sandbox nicht, es gibt dort keinen Browser. Unit-Tests ins test-Skript, Browser-Tests in ein eigenes Skript wie test:e2e, oder alerd:test anlegen.";
  if (/prisma generate|@prisma\/client|PrismaClient/.test(String(output))) return "Der Prisma-Client ließ sich nicht erzeugen oder fehlt. Verlangt prisma.config eine weitere Env-Variable, im Panel unter Version → Build-Variablen einen Platzhalter eintragen.";
  return "Fehlt eine Env-Variable, im Panel unter Version → Build-Variablen einen Platzhalter eintragen.";
}

// npm 10 stürzt beim Auflösen von vitest ab (Arborist-Bug „reading 'edgesOut'“).
// npm 11 schafft es, schreibt aber ein Lockfile, das npm ci unter npm 10 ablehnt.
// Bis npm das behebt: die betroffenen Pakete benennen, statt roh zu scheitern.
export function npmResolveHint(message, names) {
  if (!/reading 'edgesOut'/.test(String(message))) return null;
  const vitest = names.filter((n) => n === "vitest" || n.startsWith("@vitest/"));
  return vitest.length
    ? `npm 10 kann vitest gerade nicht auflösen (npm-Bug „edgesOut“). ${vitest.join(" und ")} abwählen und den Rest updaten.`
    : "npm 10 ist beim Auflösen der Abhängigkeiten abgestürzt (npm-Bug „edgesOut“). Einzelne Pakete abwählen und den Rest updaten.";
}

// Kürzt Text für DB und Prompts. Ein Schnitt mitten in einem Emoji hinterlässt
// ein halbes Surrogat-Paar, das Prisma als ungültiges JSON ablehnt („lone leading
// surrogate“). toWellFormed ersetzt es durch U+FFFD. max < 0 behält das Ende.
export function clip(text, max) {
  const s = String(text ?? "");
  return (max < 0 ? s.slice(max) : s.slice(0, max)).toWellFormed();
}

// Namen, die ein Typ-Diff wirklich ändert: Deklarationen und Properties aus
// den entfernten oder geänderten Zeilen (-), ohne Kommentare und
// TypeScript-Schlüsselwörter. Neu hinzugekommene Namen kann bestehender Code
// noch nicht nutzen, sie würden nur Allerweltstreffer wie Link oder style bringen. Der Worker
// sucht sie danach im Repository, damit das Modell nicht raten muss, ob eine
// geänderte Signatur den Code trifft.
const TYPE_WORDS = new Set(["string", "number", "boolean", "bigint", "symbol", "object", "void", "any", "unknown", "never", "undefined", "null", "true", "false", "readonly", "export", "declare", "default", "extends", "implements", "keyof", "typeof", "infer", "import", "from", "public", "private", "protected", "static", "abstract", "async", "this", "new", "get", "set", "type", "interface", "function", "const", "let", "var", "class", "enum", "namespace", "module", "global", "return", "React", "Array", "Promise", "Record", "Partial", "Pick", "Omit", "options", "props", "value", "name", "children", "key", "ref", "data", "args", "callback"]);
export function changedTypeNames(diff, max = 40) {
  const names = new Set();
  for (const raw of String(diff ?? "").split("\n")) {
    if (!raw.startsWith("-") || raw.startsWith("---")) continue;
    const line = raw.slice(1).trim();
    if (!line || /^(\*|\/\*|\/\/)/.test(line)) continue;
    const found = [
      ...[...line.matchAll(/\b(?:function|interface|type|class|enum|namespace|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
      ...[...line.matchAll(/^(?:export\s+)?(?:declare\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(<]/g)].map((m) => m[1]),
    ];
    for (const name of found) if (name.length >= 3 && !TYPE_WORDS.has(name)) names.add(name);
    if (names.size >= max) break;
  }
  return [...names].slice(0, max);
}

// git grep -n -o Ausgabe (pfad:zeile:treffer) → Treffer pro Name, höchstens fünf Stellen.
export function wordHits(output, names) {
  const hits = Object.fromEntries(names.map((n) => [n, []]));
  for (const line of String(output ?? "").split("\n")) {
    const m = line.match(/^(.+?):(\d+):(.+)$/);
    if (m && hits[m[3]] && hits[m[3]].length < 5) hits[m[3]].push(`${m[1]}:${m[2]}`);
  }
  return { treffer: Object.fromEntries(Object.entries(hits).filter(([, v]) => v.length)), ohneTreffer: names.filter((n) => !hits[n].length) };
}

// Paketfamilien, die nur versionsgleich zusammenlaufen (framer-motion,
// motion-dom, motion-utils): Ein Paket verlangt ein Geschwister mit
// „^<eigene Linie>“, npm nimmt dafür aber die neueste Version der Major. Liegt
// die auf einer anderen Minor, passt der Stand nicht zusammen, auch wenn npm
// zufrieden ist. Liefert pro Abweichung Paket, Geschwister und Versionen.
export function lockstepRange(version, range) {
  const m = /^\^(\d+\.\d+\.\d+)$/.exec(typeof range === "string" ? range.trim() : "");
  if (!m || !semver.valid(version) || semver.major(version) === 0) return null;
  return semver.major(m[1]) === semver.major(version) && semver.minor(m[1]) === semver.minor(version) ? m[1] : null;
}

export function lockstepDrift(lock, list) {
  const packages = lock?.packages ?? {};
  const drift = [];
  for (const { name } of list) {
    const entry = packages[`node_modules/${name}`];
    if (!entry?.version) continue;
    for (const [dep, range] of Object.entries(entry.dependencies ?? {})) {
      const base = lockstepRange(entry.version, range);
      const resolved = packages[`node_modules/${name}/node_modules/${dep}`]?.version ?? packages[`node_modules/${dep}`]?.version;
      if (!base || !semver.valid(resolved ?? "")) continue;
      if (semver.minor(resolved) !== semver.minor(base)) drift.push({ name, version: entry.version, dep, resolved });
    }
  }
  return drift;
}

export function lockstepHint(drift) {
  if (!drift.length) return null;
  const parts = drift.map((d) => `${d.name} ${d.version} passt zu ${d.dep} ${d.version.replace(/\.\d+$/, ".x")}, npm nimmt aber ${d.dep} ${d.resolved}`);
  const names = [...new Set(drift.map((d) => d.name))].join(", ");
  return `Paketfamilie läuft auseinander: ${parts.join("; ")}. Solche Pakete laufen nur versionsgleich zusammen, der Build würde mit fehlenden Exports scheitern. Passend ist die neueste Version der Major von ${names}, sonst das Paket für diesen Lauf abwählen.`;
}

// Fortschritt innerhalb eines Worker-Schritts. Jede länger laufende Aktion wird
// ein Teilschritt mit Start, Ende und Ergebnis, die Warteschlange zeigt sie als
// Checkliste. save bekommt den ganzen Stand und schreibt ihn weg; Aufrufe
// laufen nacheinander, ein Fehler beim Speichern bricht den Job nicht ab.
export const PROGRESS_MAX_STEPS = 40;

export function createProgress(save, now = () => new Date()) {
  const steps = [];
  let queue = Promise.resolve();
  const flush = () => {
    const snapshot = { steps: steps.slice(-PROGRESS_MAX_STEPS).map((s) => ({ ...s })) };
    queue = queue.then(() => save(snapshot)).catch((error) => console.error("progress save failed", error));
    return queue;
  };
  return {
    steps,
    reset() { steps.length = 0; return flush(); },
    async step(label, fn) {
      const entry = { label, startedAt: now().toISOString() };
      steps.push(entry);
      void flush();
      try {
        const result = await fn();
        entry.ok = true;
        return result;
      } catch (error) {
        entry.ok = false;
        throw error;
      } finally {
        entry.endedAt = now().toISOString();
        void flush();
      }
    },
    flushed() { return queue; },
  };
}

// Kurzer Name für einen npm-Aufruf in der Sandbox, mit Phase davor.
export function npmStepLabel(stage, args) {
  const clean = args.filter((a) => a !== "--ignore-scripts");
  let what;
  if (clean[0] === "ci") what = "npm ci";
  else if (clean[0] === "run") what = `npm run ${clean[1]}`;
  else if (clean[0] === "install" && clean.includes("--package-lock-only")) what = "Lockfile aktualisieren";
  else if (clean[0] === "exec" && clean.includes("prisma") && clean.includes("generate")) what = "prisma generate";
  else what = `npm ${clean.join(" ")}`;
  return stage ? `${stage}: ${what}` : what;
}

// Aufräumen der Job-Ordner (Checkout, node_modules, Build, npm-Cache, 1 bis 2 GB pro Job).
// Fertige Jobs brauchen ihren Ordner nicht mehr. Fehlgeschlagene behalten ihn eine Weile,
// weil „Push erneut versuchen“ und „Vorbereitung wiederholen“ auf dem Checkout aufsetzen.
// Ordner ohne Job in der DB (gelöscht) gehen weg, alles andere bleibt.
export const DONE_STATUSES = ["CANCELLED", "PUSHED", "LIVE", "LIVE_UNVERIFIED"];
export const RETRYABLE_STATUSES = ["FAILED", "DEPLOY_FAILED"];
export const RETRY_KEEP_MS = 3 * 24 * 60 * 60_000;

export function staleJobDirs(dirs, jobs, now, keepMs = RETRY_KEEP_MS) {
  return dirs.filter((dir) => {
    const job = jobs.get(dir.jobId);
    if (!job || job.ownerId !== dir.ownerId) return true;
    if (DONE_STATUSES.includes(job.status)) return true;
    if (RETRYABLE_STATUSES.includes(job.status)) return now.getTime() - new Date(job.updatedAt).getTime() > keepMs;
    return false;
  });
}

// Enthält der live gemeldete Commit den gepushten? Antwort der GitHub-Compare-API
// für base = gepushter Commit, head = live: "ahead" (live ist neuer und baut darauf
// auf) oder "identical". Bei "behind"/"diverged" oder Fehler: nein. So gilt ein
// Update auch als live, wenn danach noch ein Commit dazukam und mit deployt wurde.
export function compareContains(json) {
  return !!json && (json.status === "ahead" || json.status === "identical");
}
