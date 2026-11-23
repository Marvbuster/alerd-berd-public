import { prisma } from "@/lib/prisma";
import { loadServices } from "@/lib/services";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";

// Alles, was der Update-Chat als Fenster braucht, wenn er über ?chat=<appId> auf
// einer anderen Seite als Dienste aufgeht (Warteschlange, Sammel-Update).
export async function loadChatProps(userId: string, applicationId: string, locale: string) {
  const [{ services }, claude, publish, localNode, { busy, lastSeen }] = await Promise.all([
    // Nur dieser eine Dienst, nicht die ganze Liste: das Fenster pollt alle 4 Sekunden.
    loadServices(userId, new Date(), applicationId),
    prisma.claudeCredential.findUnique({ where: { ownerId: userId }, select: { ownerId: true } }),
    prisma.gitHubPublishCredential.findUnique({ where: { ownerId: userId }, select: { ownerId: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: userId }, select: { ownerId: true, lastSeenAt: true } }),
    loadWorkerStatus(undefined, locale),
  ]);
  // loadServices liefert nur Dienste des Nutzers, fremde Jobs bleiben zu.
  const s = services.find((x) => x.app.id === applicationId && x.app.watch && !x.app.missing);
  if (!s) return null;
  return {
    applicationId, applicationName: s.name, candidates: s.candidates, job: s.job,
    hasClaude: !!claude, hasLocalNode: !!localNode,
    localNodeOnline: !!localNode?.lastSeenAt && Date.now() - localNode.lastSeenAt.getTime() < 10 * 60_000,
    hasPublish: !!publish, workerBusy: busy, workerLastSeen: lastSeen,
  };
}

