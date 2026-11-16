"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextPhase } from "@/lib/phase";
import { runCheckForMonitor } from "@/lib/check";
import { githubRepository } from "@/lib/repository-logic";
import { scanRepository } from "@/lib/repository-watch";
import { refreshReferenceData } from "@/lib/version-watch";
import { classifyProbe, hostOf, httpPathOk, LIVENESS_PATH, originsOf, SPEC_PATHS, type ProbeKind } from "@/lib/service-logic";
import { saveRepository } from "@/app/coolify/repository-actions";

export type MonitoringSuggestion = {
  kind: "HEALTH" | "HTTP";
  origin: string;
  healthPath: string | null;
  // Pfad für Erreichbarkeit: /api/health, wenn die App eine hat, sonst die Startseite.
  httpPath: string | null;
  // needed: die App hat schon einen Token, der muss hier rein.
  // generated: die Route wartet auf einen Token, Alerd hat einen erzeugt.
  token: "needed" | "generated" | "none";
  generatedToken: string | null;
  found: ProbeKind;
};
export type SuggestState = { ok?: boolean; message?: string; suggestion?: MonitoringSuggestion | null; origins?: string[] };
export type ActionState = { ok?: boolean; message?: string; ids?: string[] };

function refresh() {
  revalidatePath("/services"); revalidatePath("/settings", "layout");
}

async function ownService(applicationId: string, ownerId: string) {
  return prisma.coolifyApplication.findFirst({
    where: { id: applicationId, missingSince: null, serviceAt: { not: null }, connection: { ownerId } },
    select: { id: true, name: true, domains: true, repository: true, branch: true, baseDirectory: true, _count: { select: { monitors: true } }, repositoryWatch: { select: { id: true } } },
  });
}

// Eigener, kurzer GET ohne Weiterleitungen. Ziele kommen nur aus originsOf()
// (öffentliche https-Domains der eigenen Coolify-App).
async function probe(url: string): Promise<{ status: number; json: unknown } | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": "AlerdBerd-Setup", accept: "application/json" }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(6_000) });
    const type = response.headers.get("content-type") ?? "";
    const text = type.includes("json") ? (await response.text()).slice(0, 20_000) : "";
    let json: unknown = null;
    if (text) { try { json = JSON.parse(text); } catch { /* kein JSON */ } }
    return { status: response.status, json };
  } catch { return null; }
}

export async function addServices(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const ids = form.getAll("applicationId").map(String).filter((id) => /^[a-z0-9-]{10,40}$/i.test(id)).slice(0, 200);
  if (!ids.length) return { ok: false, message: "Mindestens eine App auswählen." };
  const result = await prisma.coolifyApplication.updateMany({
    where: { id: { in: ids }, serviceAt: null, missingSince: null, connection: { ownerId: user.id } },
    data: { serviceAt: new Date(), hiddenAt: null },
  });
  refresh();
  return result.count ? { ok: true, ids } : { ok: false, message: "Die Apps sind schon angelegt oder nicht mehr in Coolify." };
}

// Zurück in den Vorrat. Die Monitore bleiben samt Verlauf erhalten, aber
// pausiert, damit für einen nicht angezeigten Dienst keine Alarme kommen.
export async function removeService(applicationId: string): Promise<void> {
  const user = await requireUser();
  const app = await prisma.coolifyApplication.findFirst({ where: { id: applicationId, connection: { ownerId: user.id } }, select: { id: true, monitors: { select: { monitorId: true } } } });
  if (!app) return;
  await prisma.$transaction([
    prisma.coolifyApplication.update({ where: { id: app.id }, data: { serviceAt: null } }),
    prisma.monitor.updateMany({ where: { id: { in: app.monitors.map((m) => m.monitorId) }, ownerId: user.id }, data: { enabled: false } }),
  ]);
  refresh();
}

export async function suggestMonitoring(applicationId: string): Promise<SuggestState> {
  const user = await requireUser();
  const app = await ownService(applicationId, user.id);
  if (!app) return { ok: false, message: "Dienst nicht gefunden." };
  const origins = originsOf(app.domains);
  if (!origins.length) return { ok: true, suggestion: null, origins, message: "Keine öffentliche https-Domain in Coolify hinterlegt." };
  let liveness: string | null = null;
  for (const origin of origins) {
    for (const path of SPEC_PATHS) {
      const result = await probe(origin + path);
      const found = result ? classifyProbe("spec", result.status, result.json) : "none";
      if (found === "none") continue;
      const token = found === "spec-protected" ? "needed" : found === "spec-unconfigured" ? "generated" : "none";
      return { ok: true, origins, suggestion: { kind: "HEALTH", origin, healthPath: path, httpPath: null, token, generatedToken: token === "generated" ? randomBytes(24).toString("base64url") : null, found } };
    }
    if (!liveness) {
      const result = await probe(origin + LIVENESS_PATH);
      if (result && classifyProbe("liveness", result.status, result.json) === "liveness") liveness = origin;
    }
  }
  const http = (origin: string, httpPath: string, found: ProbeKind): MonitoringSuggestion => ({ kind: "HTTP", origin, healthPath: null, httpPath, token: "none", generatedToken: null, found });
  if (liveness) return { ok: true, origins, suggestion: http(liveness, LIVENESS_PATH, "liveness") };
  // Ohne Health-Route bleibt die Startseite. Erreichbarkeit braucht keine eigene Route.
  const root = await probe(origins[0] + "/");
  return { ok: true, origins, suggestion: http(origins[0], "/", root ? classifyProbe("root", root.status, null) : "none") };
}

const KIND_NAME = { HEALTH: "Spec-Health", HTTP: "Erreichbarkeit", PUSH: "Push" } as const;

export async function createServiceMonitor(applicationId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const app = await ownService(applicationId, user.id);
  if (!app) return { ok: false, message: "Dienst nicht gefunden." };
  const kindRaw = String(form.get("kind") ?? "");
  const kind = kindRaw === "HTTP" ? "HTTP" : kindRaw === "PUSH" ? "PUSH" : "HEALTH";
  const origins = originsOf(app.domains);
  const origin = String(form.get("origin") ?? "");
  // Nur Ziele aus den eigenen Domains, keine frei eingegebenen URLs.
  if (kind !== "PUSH" && !origins.includes(origin)) return { ok: false, message: "Domain passt nicht zur App." };
  const healthPath = kind === "HEALTH" ? String(form.get("healthPath") ?? "") : null;
  const httpPath = String(form.get("httpPath") ?? "/").trim() || "/";
  if (kind === "HTTP" && !httpPathOk(httpPath)) return { ok: false, message: "Pfad muss mit / beginnen, etwa / oder /api/health." };
  if (kind === "HEALTH" && !SPEC_PATHS.includes(healthPath as (typeof SPEC_PATHS)[number])) return { ok: false, message: "Unbekannter Health-Pfad." };
  // Leer ist erlaubt (offene Spec-Route); sonst ein vollständiger Token ohne Leerzeichen.
  const bearerToken = kind === "HEALTH" ? String(form.get("bearerToken") ?? "").trim() : "";
  if (bearerToken && (bearerToken.length < 16 || bearerToken.length > 500 || /\s/.test(bearerToken))) return { ok: false, message: "Token der App vollständig einfügen." };
  const target = kind === "HTTP" ? origin + httpPath : kind === "HEALTH" ? origin : (hostOf(app.domains?.split(/[\s,]+/)[0]) ?? app.name);

  const existing = await prisma.monitor.findMany({ select: { phase: true } });
  const monitor = await prisma.monitor.create({
    data: {
      ownerId: user.id, name: app._count.monitors ? `${app.name} · ${KIND_NAME[kind]}` : app.name,
      kind, target, healthPath, bearerToken: bearerToken || null,
      method: kind === "HTTP" ? "GET" : null, enabled: true, intervalSec: 60, timeoutMs: 10_000,
      phase: nextPhase(existing.map((m) => m.phase)),
      ingestToken: kind === "PUSH" ? randomBytes(24).toString("base64url") : null,
      coolifyLinks: { create: { applicationId: app.id } },
    },
    select: { id: true },
  });
  // Gleich einmal prüfen, damit der Dienst nicht bis zum nächsten Lauf grau bleibt.
  if (kind !== "PUSH") { try { await runCheckForMonitor(monitor.id); } catch { /* der reguläre Lauf holt es nach */ } }

  // Versionsüberwachung: Git-Abgleich mit den Angaben aus Coolify einrichten und einmal lesen.
  let note = "";
  if (kind === "HEALTH" && form.get("versionWatch") === "on" && !app.repositoryWatch) {
    let repository = "";
    try { repository = githubRepository(app.repository ?? ""); } catch { /* kein GitHub-Repo */ }
    if (repository && app.branch) {
      const dir = app.baseDirectory.replace(/^\/+|\/+$/g, "");
      const fd = new FormData();
      fd.set("repository", repository); fd.set("branch", app.branch);
      fd.set("manifestPath", `${dir ? `${dir}/` : ""}package.json`); fd.set("lockfilePath", `${dir ? `${dir}/` : ""}package-lock.json`);
      const saved = await saveRepository(app.id, {}, fd);
      const watch = saved.ok ? await prisma.repositoryWatch.findUnique({ where: { applicationId: app.id }, select: { id: true } }) : null;
      if (watch) { try { await scanRepository(watch.id, user.id); } catch { note = " Versionen konnten noch nicht gelesen werden."; } }
      else note = " Versionsüberwachung bitte in der Version manuell einrichten.";
    } else note = " Für die Versionsüberwachung fehlt in Coolify ein GitHub-Repo mit Branch.";
  }
  refresh();
  revalidatePath(`/monitors/${monitor.id}`);
  return { ok: true, message: `Monitor angelegt.${note}` };
}

// Pakete beobachten: Auswahl aus den direkten Abhängigkeiten des Git-Stands.
// Kein Paket ist Pflicht, auch next nicht.
export async function setWatchedPackages(applicationId: string, _state: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const watch = await prisma.repositoryWatch.findFirst({
    where: { applicationId, application: { connection: { ownerId: user.id } } },
    select: { id: true, snapshot: { select: { dependencies: true } }, packages: { select: { name: true } } },
  });
  if (!watch) return { ok: false, message: "Erst die Versionsüberwachung einrichten." };
  const known = new Set((Array.isArray(watch.snapshot?.dependencies) ? watch.snapshot.dependencies as { name?: unknown }[] : []).map((d) => d.name).filter((n): n is string => typeof n === "string"));
  const picked = [...new Set(form.getAll("package").map(String))].filter((name) => known.has(name)).slice(0, 60);
  const current = watch.packages.map((p) => p.name);
  const added = picked.filter((n) => !current.includes(n));
  await prisma.$transaction([
    prisma.watchedPackage.deleteMany({ where: { watchId: watch.id, name: { notIn: picked } } }),
    ...added.map((name) => prisma.watchedPackage.create({ data: { watchId: watch.id, name } })),
  ]);
  // Neue Pakete brauchen npm-Stand und Sicherheitsmeldungen, sonst bleibt die Zeile leer.
  if (added.length) await refreshReferenceData().catch(() => {});
  refresh();
  return { ok: true, message: picked.length ? `${picked.length === 1 ? "1 Paket" : `${picked.length} Pakete`} beobachtet.` : "Kein Paket beobachtet." };
}
