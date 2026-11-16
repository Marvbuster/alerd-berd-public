import { prisma } from "@/lib/prisma";
import { sha256hex } from "@/lib/auth";
import { sendWebPushTo } from "@/lib/alert";
import { jobLabel, jobPackages } from "@/lib/dependency-target";
import { dependencyPushText } from "../../scripts/dependency-worker-lib.mjs";
import { messageCode, recipientLocale } from "../../scripts/i18n.mjs";

const LEASE_MS = 90_000;

export async function authenticateLocalNode(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token.startsWith("alrd_")) return null;
  const keyHash = await sha256hex(token);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash }, select: { id: true, userId: true, revokedAt: true, localAnalysisNode: { select: { ownerId: true } } } });
  if (!apiKey || apiKey.revokedAt || !apiKey.localAnalysisNode || apiKey.localAnalysisNode.ownerId !== apiKey.userId) return null;
  const now = new Date();
  const nodeName = request.headers.get("x-alerd-node-name")?.trim().slice(0, 100) || null;
  const model = request.headers.get("x-alerd-node-model")?.trim().slice(0, 160) || null;
  await prisma.$transaction([
    prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: now } }),
    prisma.localAnalysisNode.update({ where: { ownerId: apiKey.userId }, data: { lastSeenAt: now, ...(nodeName ? { nodeName } : {}), ...(model ? { model } : {}) } }),
  ]);
  return { ownerId: apiKey.userId, nodeName, model };
}

export async function claimLocalTask(ownerId: string, nodeName: string | null, model: string | null) {
  const now = new Date();
  const candidate = await prisma.localAnalysisTask.findFirst({ where: { ownerId, OR: [{ status: "PENDING" }, { status: "CLAIMED", leaseUntil: { lt: now } }] }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.localAnalysisTask.updateMany({ where: { id: candidate.id, ownerId, OR: [{ status: "PENDING" }, { status: "CLAIMED", leaseUntil: { lt: now } }] }, data: { status: "CLAIMED", claimedAt: now, leaseUntil, nodeName, model, lastError: null } });
  if (!claimed.count) return null;
  return prisma.localAnalysisTask.findUnique({ where: { id: candidate.id }, select: { id: true, jobId: true, phase: true, prompt: true, leaseUntil: true } });
}

export async function heartbeatLocalTask(ownerId: string, taskId: string) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const result = await prisma.localAnalysisTask.updateMany({ where: { id: taskId, ownerId, status: "CLAIMED", leaseUntil: { gt: now } }, data: { leaseUntil } });
  return result.count ? leaseUntil : null;
}

// Wie der Worker nach einem Claude-Schritt: Push an die Geräte des Owners und
// nach dem Fazit den Git-Stand zum Neu-Lesen markieren.
async function afterLocalStep(jobId: string, status: "READY_FOR_REVIEW" | "LIVE" | "FAILED") {
  const job = await prisma.dependencyJob.findUnique({ where: { id: jobId }, select: { ownerId: true, owner: { select: { locale: true } }, applicationId: true, packageName: true, targetVersion: true, packages: true, application: { select: { name: true } } } });
  if (!job) return;
  if (status === "LIVE") await prisma.repositoryWatch.updateMany({ where: { applicationId: job.applicationId }, data: { lastAttemptAt: null } });
  const locale = recipientLocale(job.owner?.locale);
  const text = dependencyPushText(status, { appName: job.application.name, label: jobLabel(jobPackages(job), locale) }, locale);
  if (text) await sendWebPushTo(job.ownerId, { ...text, url: `/services#app-${job.applicationId}~chat`, tag: `job-${jobId}` }).catch((error) => console.error("[local-node] push failed", error));
}

export async function finishLocalTask(ownerId: string, taskId: string, content: string) {
  const now = new Date();
  const task = await prisma.localAnalysisTask.findFirst({ where: { id: taskId, ownerId, status: "CLAIMED", leaseUntil: { gt: now } }, select: { id: true, jobId: true, phase: true } });
  if (!task) return false;
  const status = task.phase === "ANALYSIS" ? "READY_FOR_REVIEW" : "LIVE";
  const [, , moved] = await prisma.$transaction([
    prisma.localAnalysisTask.update({ where: { id: task.id }, data: { status: "COMPLETED", result: content, completedAt: now, leaseUntil: null } }),
    prisma.dependencyMessage.create({ data: { jobId: task.jobId, role: "ASSISTANT", content } }),
    prisma.dependencyJob.updateMany({ where: { id: task.jobId, ownerId, status: "AWAITING_NODE" }, data: { status, lastError: null } }),
  ]);
  if (moved.count) await afterLocalStep(task.jobId, status);
  return true;
}

// Die Node meldet einen Fehler (Modell nicht erreichbar, Antwort unbrauchbar).
// Der Job scheitert sichtbar, im Chat lässt sich der Schritt wiederholen. Ohne
// das würde die Node denselben Task nach jeder abgelaufenen Lease erneut greifen.
export async function failLocalTask(ownerId: string, taskId: string, error: string) {
  const now = new Date();
  const task = await prisma.localAnalysisTask.findFirst({ where: { id: taskId, ownerId, status: "CLAIMED" }, select: { id: true, jobId: true, phase: true } });
  if (!task) return false;
  const message = messageCode("worker.localNodeError", { error: error.slice(0, 500) || messageCode("common.unknownError") });
  const [, , moved] = await prisma.$transaction([
    prisma.localAnalysisTask.update({ where: { id: task.id }, data: { status: "FAILED", lastError: message, completedAt: now, leaseUntil: null } }),
    prisma.dependencyMessage.create({ data: { jobId: task.jobId, role: "SYSTEM", content: messageCode("worker.localNodeFailure", { error: message }) } }),
    prisma.dependencyJob.updateMany({ where: { id: task.jobId, ownerId, status: "AWAITING_NODE" }, data: { status: "FAILED", lastError: message } }),
  ]);
  if (moved.count) await afterLocalStep(task.jobId, "FAILED");
  return true;
}
