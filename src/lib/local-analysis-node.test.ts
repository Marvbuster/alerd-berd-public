import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  message: { create: vi.fn() },
  job: { updateMany: vi.fn(), findUnique: vi.fn() },
  watch: { updateMany: vi.fn() },
  apiKey: { findUnique: vi.fn(), update: vi.fn() },
  node: { update: vi.fn() },
  push: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  localAnalysisTask: mocks.task, dependencyMessage: mocks.message, dependencyJob: mocks.job, repositoryWatch: mocks.watch,
  apiKey: mocks.apiKey, localAnalysisNode: mocks.node,
  $transaction: (ops: unknown[]) => Promise.all(ops),
} }));
vi.mock("@/lib/alert", () => ({ sendWebPushTo: mocks.push }));
vi.mock("@/lib/auth", () => ({ sha256hex: async (v: string) => `hash:${v}` }));
import { authenticateLocalNode, failLocalTask, finishLocalTask } from "./local-analysis-node";

const job = { ownerId: "u1", applicationId: "a1", packageName: "next", targetVersion: "16.4.6", packages: null, application: { name: "Weedscore" } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.task.update.mockResolvedValue({}); mocks.message.create.mockResolvedValue({});
  mocks.job.findUnique.mockResolvedValue(job); mocks.push.mockResolvedValue(undefined);
});

describe("lokale Analyse-Node", () => {
  it("lehnt fremde, widerrufene oder nicht zugeordnete Keys ab", async () => {
    const req = (token: string) => new Request("https://x/api/local-node/tasks/next", { headers: { authorization: `Bearer ${token}` } });
    expect(await authenticateLocalNode(req("kein_key"))).toBeNull();
    mocks.apiKey.findUnique.mockResolvedValue({ id: "k", userId: "u1", revokedAt: new Date(), localAnalysisNode: { ownerId: "u1" } });
    expect(await authenticateLocalNode(req("alrd_x"))).toBeNull();
    mocks.apiKey.findUnique.mockResolvedValue({ id: "k", userId: "u1", revokedAt: null, localAnalysisNode: null });
    expect(await authenticateLocalNode(req("alrd_x"))).toBeNull();
  });
  it("schließt die Analyse ab, schickt Push und lässt das Fazit den Git-Stand neu lesen", async () => {
    mocks.task.findFirst.mockResolvedValue({ id: "t1", jobId: "j1", phase: "LIVE_REVIEW" });
    mocks.job.updateMany.mockResolvedValue({ count: 1 });
    expect(await finishLocalTask("u1", "t1", "Alles live und stabil, Fazit steht.")).toBe(true);
    expect(mocks.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "LIVE", lastError: null } }));
    expect(mocks.watch.updateMany).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("u1", expect.objectContaining({ url: "/services#app-a1~chat" }));
  });
  it("meldet einen Fehler sichtbar, statt den Task offen zu lassen", async () => {
    mocks.task.findFirst.mockResolvedValue({ id: "t1", jobId: "j1", phase: "ANALYSIS" });
    mocks.job.updateMany.mockResolvedValue({ count: 1 });
    expect(await failLocalTask("u1", "t1", "MLX 500")).toBe(true);
    expect(mocks.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
    expect(mocks.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });
  it("ignoriert Ergebnisse für abgelaufene oder fremde Tasks", async () => {
    mocks.task.findFirst.mockResolvedValue(null);
    expect(await finishLocalTask("u1", "t9", "Text, der lang genug ist.")).toBe(false);
    expect(mocks.message.create).not.toHaveBeenCalled();
  });
});
