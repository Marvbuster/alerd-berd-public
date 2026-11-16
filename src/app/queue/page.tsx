import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadQueue } from "@/lib/dependency-queue-load";
import { loadServices } from "@/lib/services";
import { loadWorkerStatus } from "@/lib/dependency-worker-status";
import { PageHeader } from "@/components/PageHeader";
import { QueueBoard } from "@/components/QueueBoard";
import { QueueChat } from "@/components/QueueChat";

// Was der Update-Worker gerade macht, was danach kommt und wo du dran bist.
// Eigene Jobs lassen sich hier voll bedienen: ?chat=<appId> öffnet den Update-Chat.
export const dynamic = "force-dynamic";

async function loadChat(userId: string, applicationId: string) {
  const [{ services }, claude, publish, localNode, { busy, lastSeen }] = await Promise.all([
    loadServices(userId),
    prisma.claudeCredential.findUnique({ where: { ownerId: userId }, select: { ownerId: true } }),
    prisma.gitHubPublishCredential.findUnique({ where: { ownerId: userId }, select: { ownerId: true } }),
    prisma.localAnalysisNode.findUnique({ where: { ownerId: userId }, select: { ownerId: true, lastSeenAt: true } }),
    loadWorkerStatus(),
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

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ chat?: string }> }) {
  const user = await requireUser();
  const { chat } = await searchParams;
  const [queue, chatProps] = await Promise.all([
    loadQueue(user.id),
    typeof chat === "string" && chat ? loadChat(user.id, chat) : null,
  ]);
  return <main className="mx-auto max-w-4xl px-4 py-8 sm:px-7">
    <PageHeader title="Warteschlange" description="Was der Worker gerade macht und was danach kommt." icon="queue" />
    <QueueBoard initial={queue} />
    {chatProps && <QueueChat key={chatProps.applicationId} {...chatProps} />}
  </main>;
}
