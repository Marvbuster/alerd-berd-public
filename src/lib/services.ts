import semver from "semver";
import { prisma } from "@/lib/prisma";
import { loadMonitorNodes } from "@/lib/monitor-view";
import { evaluatePackage, knownIssues, loadWatchContext, type WatchContext } from "@/lib/version-watch";
import { LEVEL_RANK, NODE_RUNTIME, sameCommit, worstLevel as worstOf, type Evaluation, type WatchLevel } from "@/lib/version-watch-logic";
import type { DirectDependency } from "@/lib/repository-logic";
import { alreadyDelivered, knownIssuesFor, latestMatureOnLine, updateCandidate, type RecommendedMajor, type UpdateCandidate } from "@/lib/dependency-target";
import recommendedMajorsData from "@/data/recommended-majors.json";
import { TERMINAL_STATUSES } from "@/lib/dependency-phase";
import { hostOf, sameHost } from "@/lib/service-logic";
import type { VizNode } from "@/lib/viz";

const recommendedMajors = recommendedMajorsData.majors as RecommendedMajor[];

// Ein Dienst ist eine Coolify-App, die du bewusst angelegt hast (serviceAt).
// Alle anderen Apps liegen im Vorrat und erscheinen nur im Dialog „Dienst
// anlegen“. Die Datenbank bleibt sonst unverändert, das hier ist eine Sicht.
// Die ID "app-<applicationId>" ist zugleich der URL-Hash.

const NEW_FOR_MS = 7 * 24 * 60 * 60_000;

export type ServiceApp = {
  id: string; connectionLabel: string; status: string | null; domains: string | null;
  repository: string | null; branch: string | null; baseDirectory: string; buildPack: string | null; missing: boolean;
  autoDeploy: boolean | null;
  watch: {
    id: string; repository: string; branch: string; manifestPath: string; lockfilePath: string; lastError: string | null; buildEnv: string | null;
    snapshot: { commitSha: string; declaredVersion: string | null; lockedVersion: string | null; scannedAt: Date; dependencies: unknown } | null;
  } | null;
};

export type ServiceRecord = {
  id: string;
  name: string;
  domain: string | null;
  checkIds: string[];
  app: ServiceApp;
  liveNext: string | null;
  watchLevel: WatchLevel | null;
  latestPatch: string | null;
  updateTarget: string | null;
  jobActive: boolean;
  job: Awaited<ReturnType<typeof loadJobs>>[number] | null;
  // Bestehende Monitore ohne Dienst, deren URL zur Domain passt: „übernehmen“.
  mergeMonitors: { id: string; name: string }[];
  // Laufzeit aus der Spec-Health (runtime.node).
  node: ServicePackage | null;
  // Registrierte Pakete neben next und alle direkten Abhängigkeiten aus dem Git-Stand.
  packages: ServicePackage[];
  dependencies: DirectDependency[];
  // Schlimmste Stufe über next, Node und registrierte Pakete; Pakete mit neuerem Patch.
  alertLevel: WatchLevel | null;
  packageUpdates: number;
  // Was sich im Update-Chat bündeln lässt: next und beobachtete Pakete mit neuerer Version.
  candidates: UpdateCandidate[];
  // runtime.commit des laufenden Builds und ob er dem Git-Stand entspricht.
  liveCommit: string | null;
  commitProven: boolean;
};

export type ServicePackage = {
  name: string; version: string | null; gitVersion: string | null; source: "live" | "git" | null; dev: boolean;
  level: WatchLevel; findings: Evaluation["findings"]; latestPatch: string | null; latest: string | null;
  // Dasselbe Ziel wie in „Update prüfen“, damit Zeile und Auswahl übereinstimmen.
  update?: UpdateCandidate | null;
};

export type PoolApp = { id: string; name: string; domain: string | null; repository: string | null; connectionLabel: string; isNew: boolean };

// Nur der letzte Job je Dienst zählt (Chat, Phase, „schon geliefert“). Früher
// kamen die letzten 200 Jobs samt je 50 Nachrichten, bei jedem Refresh alle 4 s
// Megabytes an Analysen. Erst die Ids per DISTINCT ON, dann nur diese Jobs.
export async function loadJobs(ownerId: string, applicationId?: string) {
  const latest = applicationId
    ? await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "DependencyJob" WHERE "ownerId" = ${ownerId} AND "applicationId" = ${applicationId} ORDER BY "updatedAt" DESC LIMIT 1`
    : await prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT ON ("applicationId") id FROM "DependencyJob" WHERE "ownerId" = ${ownerId} ORDER BY "applicationId", "updatedAt" DESC`;
  if (!latest.length) return [];
  return prisma.dependencyJob.findMany({
    where: { ownerId, id: { in: latest.map((j) => j.id) } }, orderBy: { updatedAt: "desc" },
    select: {
      id: true, applicationId: true, packageName: true, targetVersion: true, packages: true, model: true, engine: true, status: true, updatedAt: true,
      workerLockedUntil: true, workerAttemptAt: true, lastError: true, validationLog: true, diffHash: true, publishApprovalAt: true, publishedAt: true, progress: true, batchId: true,
      messages: { orderBy: { createdAt: "asc" }, take: 50, select: { id: true, role: true, content: true, createdAt: true } },
    },
  });
}

function worstLevel(nodes: VizNode[]): WatchLevel | null {
  const levels = nodes.flatMap((n) => n.packages.filter((p) => p.name === "next").map((p) => p.level));
  return levels.length ? levels.reduce((a, b) => LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a) : null;
}

function liveVersion(nodes: VizNode[]): string | null {
  const versions = [...new Set(nodes.flatMap((n) => n.packages.filter((p) => p.name === "next" && p.version).map((p) => p.version as string)))];
  return versions.length === 1 ? versions[0] : versions.length > 1 ? "mehrere" : null;
}

// only: genau ein Dienst (Chat-Fenster auf anderen Seiten). services enthält dann
// höchstens diesen, pool, others und mergeMonitors sind unvollständig und nicht zu verwenden.
export async function loadServices(ownerId: string, now = new Date(), only?: string): Promise<{ services: ServiceRecord[]; pool: PoolApp[]; others: string[]; nodes: VizNode[]; context: WatchContext }> {
  const [nodes, context, connections, jobs] = await Promise.all([
    loadMonitorNodes(ownerId, only),
    loadWatchContext(),
    prisma.coolifyConnection.findMany({
      where: { ownerId }, orderBy: { createdAt: "asc" },
      select: { label: true, applications: { ...(only ? { where: { id: only } } : {}), orderBy: { name: "asc" }, select: {
        id: true, name: true, status: true, domains: true, repository: true, branch: true, baseDirectory: true,
        buildPack: true, missingSince: true, serviceAt: true, firstSeenAt: true, autoDeploy: true,
        repositoryWatch: { select: {
          id: true, repository: true, branch: true, manifestPath: true, lockfilePath: true, lastError: true, buildEnv: true,
          snapshot: { select: { commitSha: true, declaredVersion: true, lockedVersion: true, scannedAt: true, dependencies: true } },
          packages: { select: { name: true }, orderBy: { name: "asc" } },
        } },
      } } },
    }),
    loadJobs(ownerId, only),
  ]);
  const latestJob = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) if (!latestJob.has(job.applicationId)) latestJob.set(job.applicationId, job);
  const unlinked = nodes.filter((n) => !n.coolifyApps.length);
  const apps = connections.flatMap((c) => c.applications.map((a) => ({ ...a, connectionLabel: c.label })));

  const services: ServiceRecord[] = apps.filter((a) => a.serviceAt).map((a) => {
    const checks = nodes.filter((n) => n.coolifyApps.some((ca) => ca.id === a.id));
    const snapshot = a.repositoryWatch?.snapshot ?? null;
    const job = latestJob.get(a.id) ?? null;
    // Live gemeldet schlägt Git: was läuft, zählt. Sonst das Lockfile im Git-Stand.
    const live = new Map(checks.flatMap((n) => n.packages.filter((p) => p.version).map((p) => [p.name, p.version as string] as const)));
    const dependencies = Array.isArray(snapshot?.dependencies) ? snapshot.dependencies as DirectDependency[] : [];
    // Ältere Snapshots kennen nur next, bis der nächste Scan alle Abhängigkeiten liest.
    const gitVersionOf = (name: string) => dependencies.find((d) => d.name === name)?.locked ?? (name === "next" ? snapshot?.lockedVersion ?? null : null);
    // Meldet der Dienst den Commit seines Builds und ist es der Git-Stand, sind
    // alle Versionen aus dem Lockfile live belegt.
    const liveCommits = [...new Set(checks.map((n) => n.commit).filter((c): c is string => !!c))];
    const liveCommit = liveCommits.length === 1 ? liveCommits[0] : null;
    const commitProven = !!snapshot && sameCommit(liveCommit, snapshot.commitSha);
    const describe = (name: string): ServicePackage => {
      const gitVersion = gitVersionOf(name);
      const version = live.get(name) ?? gitVersion;
      const e = evaluatePackage(context, name, version, now);
      const reg = context.registry[name];
      const patch = version && reg ? latestMatureOnLine(version, reg.versions, now) : null;
      return {
        name, version, gitVersion, source: live.has(name) || (commitProven && version) ? "live" : version ? "git" : null, dev: dependencies.find((d) => d.name === name)?.dev ?? false,
        level: e.level, findings: e.findings, latestPatch: patch && version && semver.gt(patch, version) ? patch : null, latest: e.latest,
      };
    };
    // Beobachtet wird, was du ausgewählt hast, next eingeschlossen. Kein Paket ist Pflicht.
    const packages = (a.repositoryWatch?.packages ?? []).map((p) => describe(p.name));
    const node = live.has(NODE_RUNTIME) ? describe(NODE_RUNTIME) : null;
    // Der Chip „Sicherheit“ zählt nur echte Risiken: Advisories, bekannte Probleme,
    // Node ohne Support oder ohne Sicherheits-Release. Ein bloßer Patch-Rückstand nicht.
    const risky = (name: string, findings: Evaluation["findings"]) => findings
      .filter((f) => f.kind === "advisory" || f.kind === "known-issue" || (name === NODE_RUNTIME && f.kind === "patch-backlog"))
      .map((f) => f.level);
    const levels = [...(node ? risky(NODE_RUNTIME, node.findings) : []), ...packages.flatMap((p) => risky(p.name, p.findings))];
    const candidates: UpdateCandidate[] = [];
    for (const p of packages) {
      const c = updateCandidate(p.name, gitVersionOf(p.name), context.registry[p.name]?.versions, p.findings.filter((f) => f.kind === "advisory").map((f) => ({ version: f.fixedIn ?? "", critical: f.severity === "critical" })), now, recommendedMajors);
      if (c?.recommended) c.recommended.issues = context.registry[p.name]?.majorIssues?.[semver.major(c.to)] ?? null;
      const known = c ? knownIssuesFor(p.name, c.to, knownIssues) : [];
      if (c && known.length) c.knownIssues = known;
      // Eine Empfehlung mit bekanntem Problem am Ziel wäre ein Widerspruch: erst abwarten.
      if (c?.recommended && known.length) c.recommended.hold = true;
      if (c && !alreadyDelivered(c.to, { jobs: job ? [job] : [], runtimeVersions: [live.get(p.name)], name: p.name })) { candidates.push(c); p.update = c; }
    }
    const nextPkg = packages.find((p) => p.name === "next");
    const latestPatch = nextPkg?.latestPatch ?? null;
    const updateTarget = candidates.find((c) => c.name === "next")?.to ?? null;
    return {
      node, packages, dependencies, candidates, liveCommit, commitProven,
      alertLevel: levels.length ? worstOf(levels) : null,
      packageUpdates: candidates.length,
      id: `app-${a.id}`, name: a.name, domain: hostOf(a.domains?.split(/[\s,]+/)[0]), checkIds: checks.map((n) => n.id),
      app: {
        id: a.id, connectionLabel: a.connectionLabel, status: a.status, domains: a.domains, repository: a.repository, branch: a.branch,
        baseDirectory: a.baseDirectory, buildPack: a.buildPack, missing: !!a.missingSince, autoDeploy: a.autoDeploy, watch: a.repositoryWatch,
      },
      liveNext: nextPkg ? liveVersion(checks) : null, watchLevel: nextPkg ? worstLevel(checks) : null, latestPatch, updateTarget,
      jobActive: !!job && !TERMINAL_STATUSES.includes(job.status), job,
      mergeMonitors: a.missingSince ? [] : unlinked.filter((n) => sameHost(n.target, a.domains)).map((n) => ({ id: n.id, name: n.label })),
    };
  });

  const pool: PoolApp[] = apps.filter((a) => !a.serviceAt && !a.missingSince).map((a) => ({
    id: a.id, name: a.name, domain: hostOf(a.domains?.split(/[\s,]+/)[0]), repository: a.repository, connectionLabel: a.connectionLabel,
    isNew: now.getTime() - a.firstSeenAt.getTime() < NEW_FOR_MS,
  }));

  services.sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Monitore ohne Coolify-App (Server-Push, fremde Dienste) erscheinen unter
  // „Weitere Monitore“, damit nichts unsichtbar weiter alarmiert. Monitore, die
  // nur an einer App im Vorrat hängen, bleiben ausgeblendet.
  const serviceIds = new Set(services.flatMap((s) => s.checkIds));
  const others = unlinked.map((n) => n.id);
  return { services, pool, others, nodes: nodes.filter((n) => serviceIds.has(n.id) || others.includes(n.id)), context };
}
