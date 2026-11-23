import { german } from "@/test/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), batch: { findFirst: vi.fn(), update: vi.fn() }, job: { updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, links: { findMany: vi.fn() }, message: { createMany: vi.fn(), create: vi.fn() },
  claude: { findUnique: vi.fn() }, localNode: { findUnique: vi.fn() }, localTask: { updateMany: vi.fn() }, transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { dependencyBatch: mocks.batch, dependencyJob: mocks.job, dependencyMessage: mocks.message, claudeCredential: mocks.claude, localAnalysisNode: mocks.localNode, localAnalysisTask: mocks.localTask, monitorCoolifyApplication: mocks.links, $transaction: mocks.transaction } }));
import { approveBatchAnalyses, approveBatchPushes, cancelBatch, resumeBatch, setBatchConclusionEngine, switchBatchEngine } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "alice" });
  mocks.transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  mocks.job.updateMany.mockResolvedValue({ count: 1 });
});

const form = (ids: string[]) => { const data = new FormData(); for (const id of ids) data.append("job", id); return data; };

describe("approveBatchAnalyses", () => {
  const jobs = [{ id: "a", status: "READY_FOR_REVIEW" }, { id: "b", status: "READY_FOR_REVIEW" }, { id: "c", status: "FAILED" }];

  it("gibt die gewählten frei und löst die übrigen aus dem Lauf", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs });
    expect((await approveBatchAnalyses("batch1", {}, form(["a", "c"]))).ok).toBe(true);
    const [approve, drop] = mocks.job.updateMany.mock.calls.map((c) => c[0]);
    expect(approve).toMatchObject({ where: { id: { in: ["a"] }, ownerId: "alice", batchId: "batch1", status: "READY_FOR_REVIEW" }, data: { status: "APPROVED" } });
    expect(drop).toMatchObject({ where: { id: { in: ["b"] } }, data: { batchId: null } });
    const notes = mocks.message.createMany.mock.calls[0][0].data.map((m: { jobId: string; content: string }) => [m.jobId, german(m.content)]);
    expect(notes).toEqual([["a", expect.stringMatching(/freigegeben/)], ["b", expect.stringMatching(/einzeln weiter/)]]);
  });

  it("wartet, solange noch eine Analyse läuft", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs: [...jobs, { id: "d", status: "ANALYZING" }] });
    expect((await approveBatchAnalyses("batch1", {}, form(["a"]))).ok).toBe(false);
    expect(mocks.job.updateMany).not.toHaveBeenCalled();
  });

  it("verlangt mindestens einen Dienst", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs });
    expect(german(await approveBatchAnalyses("batch1", {}, form([])))).toMatchObject({ ok: false, message: "Wähle mindestens einen Dienst." });
  });

  it("findet fremde Läufe nicht", async () => {
    mocks.batch.findFirst.mockResolvedValue(null);
    expect((await approveBatchAnalyses("batch1", {}, form(["a"]))).ok).toBe(false);
    expect(mocks.batch.findFirst.mock.calls[0][0].where).toEqual({ id: "batch1", ownerId: "alice" });
  });
});

describe("switchBatchEngine", () => {
  beforeEach(() => { mocks.job.findFirst.mockResolvedValue({ id: "a", batchId: "batch1", engine: "CLAUDE" }); });

  it("startet die Analyse mit der anderen Engine neu, ohne alte Claude-Session", async () => {
    mocks.localNode.findUnique.mockResolvedValue({ ownerId: "alice" });
    expect((await switchBatchEngine("a", "LOCAL_NODE")).ok).toBe(true);
    expect(mocks.job.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "a", status: "READY_FOR_REVIEW" }, data: { engine: "LOCAL_NODE", status: "ANALYZING", claudeSessionId: null } });
    expect(mocks.localTask.updateMany).toHaveBeenCalled();
    expect(german(mocks.message.create.mock.calls[0][0].data.content)).toMatch(/Analyse neu mit/);
  });

  it("braucht die Ziel-Engine", async () => {
    mocks.localNode.findUnique.mockResolvedValue(null);
    expect((await switchBatchEngine("a", "LOCAL_NODE")).ok).toBe(false);
    expect(mocks.job.updateMany).not.toHaveBeenCalled();
  });

  it("greift nur bei Jobs im Lauf, die an der Freigabe stehen", async () => {
    mocks.job.findFirst.mockResolvedValue(null);
    expect((await switchBatchEngine("a", "LOCAL_NODE")).ok).toBe(false);
    expect(mocks.job.findFirst.mock.calls[0][0].where).toMatchObject({ batchId: { not: null }, status: "READY_FOR_REVIEW", ownerId: "alice" });
  });
});

describe("approveBatchPushes", () => {
  const ready = (id: string, applicationId: string) => ({ id, applicationId, status: "READY_TO_PUSH", publishApprovalAt: null, diffHash: "h" });

  it("staffelt die Freigaben, Dienste mit Spec-Health zuerst, und löst die übrigen", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs: [ready("a", "appA"), ready("b", "appB"), ready("c", "appC")] });
    mocks.links.findMany.mockResolvedValue([{ applicationId: "appB" }]);
    expect((await approveBatchPushes("batch1", {}, form(["a", "b"]))).ok).toBe(true);
    const calls = mocks.job.updateMany.mock.calls.map((c) => c[0]);
    expect(calls[0].where.id).toBe("b");
    expect(calls[1].where.id).toBe("a");
    expect(calls[1].data.publishApprovalAt.getTime() - calls[0].data.publishApprovalAt.getTime()).toBe(1);
    expect(calls[2]).toMatchObject({ where: { id: { in: ["c"] } }, data: { batchId: null } });
    expect(german(mocks.message.createMany.mock.calls[0][0].data[0].content)).toMatch(/Position 1 von 2/);
  });

  it("wartet, solange noch ein Dienst vorbereitet wird", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs: [ready("a", "appA"), { id: "b", applicationId: "appB", status: "RUNNING", publishApprovalAt: null, diffHash: null }] });
    expect((await approveBatchPushes("batch1", {}, form(["a"]))).ok).toBe(false);
    expect(mocks.job.updateMany).not.toHaveBeenCalled();
  });
});

describe("setBatchConclusionEngine", () => {
  it("ändert nur die Engine und schreibt es in den Chat", async () => {
    mocks.claude.findUnique.mockResolvedValue({ ownerId: "alice" });
    mocks.job.findFirst.mockResolvedValue({ id: "a", batchId: "batch1", engine: "LOCAL_NODE" });
    expect((await setBatchConclusionEngine("a", "CLAUDE")).ok).toBe(true);
    expect(mocks.job.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { engine: "CLAUDE" } });
    expect(mocks.job.findFirst.mock.calls[0][0].where).toMatchObject({ status: "READY_TO_PUSH", publishApprovalAt: null });
  });
});

describe("resumeBatch und cancelBatch", () => {
  const jobs = [
    { id: "failed", status: "DEPLOY_FAILED", publishApprovalAt: new Date() },
    { id: "queued", status: "READY_TO_PUSH", publishApprovalAt: new Date() },
    { id: "live", status: "LIVE", publishApprovalAt: new Date() },
  ];

  it("setzt fort und nimmt den gescheiterten Dienst aus dem Lauf", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", pausedAt: new Date(), jobs });
    expect((await resumeBatch("batch1")).ok).toBe(true);
    expect(mocks.job.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ["failed"] } }, data: { batchId: null } });
    expect(mocks.batch.update).toHaveBeenCalledWith({ where: { id: "batch1" }, data: { pausedAt: null, pauseReason: null } });
  });

  it("bricht ab, nimmt wartenden Pushes die Freigabe und löst offene Dienste", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "batch1", jobs });
    expect((await cancelBatch("batch1")).ok).toBe(true);
    const [unqueue, detach] = mocks.job.updateMany.mock.calls.map((c) => c[0]);
    expect(unqueue).toMatchObject({ where: { id: { in: ["queued"] } }, data: { publishApprovalAt: null } });
    expect(detach).toMatchObject({ where: { id: { in: ["queued"] } }, data: { batchId: null } });
    expect(mocks.batch.update.mock.calls[0][0].data.cancelledAt).toBeInstanceOf(Date);
  });
});
