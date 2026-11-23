import { german } from "@/test/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), job: { updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() }, message: { create: vi.fn() }, pkg: { findMany: vi.fn() }, registry: { findMany: vi.fn() }, advisory: { findMany: vi.fn() },
  app: { findFirst: vi.fn(), findMany: vi.fn() }, batch: { create: vi.fn(), findFirst: vi.fn() }, transaction: vi.fn(), claude: { findUnique: vi.fn() }, localNode: { findUnique: vi.fn() }, localTask: { updateMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/credentials", () => ({ credentialsConfigured: () => true, encryptCredential: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { dependencyJob: mocks.job, dependencyMessage: mocks.message, monitorPackage: mocks.pkg, packageRegistry: mocks.registry, advisory: mocks.advisory, coolifyApplication: mocks.app, claudeCredential: mocks.claude, localAnalysisNode: mocks.localNode, localAnalysisTask: mocks.localTask, dependencyBatch: mocks.batch, $transaction: mocks.transaction } }));
import { approveDependencyPreparation, approveDependencyPublish, cancelDependencyJob, createDependencyBatch, createDependencyJob } from "./dependency-actions";

beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "alice" }); });

describe("cancelDependencyJob", () => {
  it("bricht nur eigene Jobs ab, die der Worker gerade nicht hält", async () => {
    mocks.job.updateMany.mockResolvedValue({ count: 1 });
    expect((await cancelDependencyJob("job1")).ok).toBe(true);
    const where = mocks.job.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "job1", ownerId: "alice" });
    expect(where.status.in).not.toContain("RUNNING");
    expect(where.status.in).not.toContain("PUBLISHING");
    expect(where.OR).toEqual([{ workerLockedUntil: null }, { workerLockedUntil: { lt: expect.any(Date) } }]);
    expect(german(mocks.message.create)).toHaveBeenCalled();
  });

  it("meldet sauber, wenn der Worker gerade arbeitet", async () => {
    mocks.job.updateMany.mockResolvedValue({ count: 0 });
    const result = await cancelDependencyJob("job1");
    expect(german(result.ok)).toBe(false);
    expect(german(result.message)).toMatch(/Worker arbeitet/);
    expect(german(mocks.message.create)).not.toHaveBeenCalled();
  });
});

describe("createDependencyJob", () => {
  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ applicationId: "app1", targetVersion: "16.4.6", ...extra })) data.set(key, value);
    return data;
  };
  beforeEach(() => {
    mocks.app.findFirst.mockResolvedValue({ id: "app1", repositoryWatch: { lockfilePath: "package-lock.json", snapshot: { commitSha: "abc1234" } } });
    mocks.claude.findUnique.mockResolvedValue({ ownerId: "alice" });
    mocks.localNode.findUnique.mockResolvedValue(null);
    mocks.job.findFirst.mockResolvedValue(null);
    mocks.job.create.mockResolvedValue({ id: "job2" });
    mocks.job.findMany.mockResolvedValue([]);
    mocks.pkg.findMany.mockResolvedValue([{ version: "16.4.5" }]);
    mocks.registry.findMany.mockResolvedValue([{ name: "next", versions: { "16.4.6": "2026-11-01T12:00:00Z" } }]);
    mocks.advisory.findMany.mockResolvedValue([]);
  });

  it("legt kein zweites Update an, wenn die Version schon gepusht oder live ist", async () => {
    mocks.job.findMany.mockResolvedValue([{ status: "LIVE", targetVersion: "16.4.6" }]);
    expect(german(await createDependencyJob({}, form({ start: "1" })))).toMatchObject({ ok: false, message: expect.stringMatching(/schon ausgeliefert/) });
    mocks.job.findMany.mockResolvedValue([]);
    mocks.pkg.findMany.mockResolvedValue([{ name: "next", version: "16.4.6" }]);
    expect(german((await createDependencyJob({}, form())).ok)).toBe(false);
    expect(mocks.job.create).not.toHaveBeenCalled();
  });

  it("startet für pnpm-Projekte einen Worker-Job", async () => {
    mocks.app.findFirst.mockResolvedValue({ id: "app1", repositoryWatch: { lockfilePath: "pnpm-lock.yaml", snapshot: { commitSha: "abc1234", dependencies: [{ name: "next", locked: "16.4.5" }] } } });
    expect(german(await createDependencyJob({}, form()))).toMatchObject({ ok: true });
    expect(mocks.job.create).toHaveBeenCalledOnce();
  });

  it("lehnt pnpm-Links ohne eindeutige Ausgangsversion ab", async () => {
    mocks.app.findFirst.mockResolvedValue({ id: "app1", repositoryWatch: { lockfilePath: "pnpm-lock.yaml", snapshot: { commitSha: "abc1234", dependencies: [{ name: "next", locked: null }] } } });
    expect(german(await createDependencyJob({}, form()))).toMatchObject({ ok: false, message: expect.stringMatching(/keine direkte Abhängigkeit/) });
    expect(mocks.job.create).not.toHaveBeenCalled();
  });

  it("startet die Analyse mit Claude direkt nach der Auswahl", async () => {
    await createDependencyJob({}, form());
    expect(mocks.job.create.mock.calls[0][0].data).toMatchObject({ engine: "CLAUDE", status: "ANALYZING" });
  });

  it("blockiert frische Releases auch bei einem manipulierten Formular", async () => {
    mocks.registry.findMany.mockResolvedValue([{ name: "next", versions: { "16.4.6": new Date().toISOString() } }]);
    const result = await createDependencyJob({}, form());
    expect(german(result)).toMatchObject({ ok: false, message: expect.stringMatching(/erst am/) });
    expect(mocks.job.create).not.toHaveBeenCalled();
  });
});

describe("Freigaben im Chat", () => {
  it("schreibt jede Freigabe als eigene Zeile in den Chat", async () => {
    mocks.job.updateMany.mockResolvedValue({ count: 1 });
    await approveDependencyPreparation("j1");
    await approveDependencyPublish("j1");
    expect(german(mocks.message.create.mock.calls.map((c) => c[0].data))).toEqual([
      { jobId: "j1", role: "SYSTEM", content: "Du hast „Update vorbereiten“ freigegeben." },
      { jobId: "j1", role: "SYSTEM", content: "Du hast „Commit & Push“ freigegeben." },
    ]);
  });

  it("schreibt nichts, wenn die Freigabe nicht greift", async () => {
    mocks.job.updateMany.mockResolvedValue({ count: 0 });
    expect((await approveDependencyPublish("j1")).ok).toBe(false);
    expect(german(mocks.message.create)).not.toHaveBeenCalled();
  });
});

describe("createDependencyBatch", () => {
  const form = (entries: string[], engine = "CLAUDE") => {
    const data = new FormData();
    data.set("engine", engine);
    for (const entry of entries) data.append("package", entry);
    return data;
  };
  beforeEach(() => {
    mocks.app.findFirst.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, repositoryWatch: { lockfilePath: "package-lock.json", snapshot: { commitSha: "abc1234", dependencies: [{ name: "next", locked: "16.4.5" }, { name: "zod", locked: "4.1.0" }] } } }));
    mocks.app.findMany.mockResolvedValue([{ id: "app1", name: "Chat" }, { id: "app2", name: "Wrap" }]);
    mocks.claude.findUnique.mockResolvedValue({ ownerId: "alice" });
    mocks.localNode.findUnique.mockResolvedValue(null);
    mocks.job.findFirst.mockResolvedValue(null);
    mocks.job.findMany.mockResolvedValue([]);
    mocks.pkg.findMany.mockResolvedValue([]);
    mocks.registry.findMany.mockResolvedValue([{ name: "next", versions: { "16.4.6": "2026-11-01T12:00:00Z" } }, { name: "zod", versions: { "4.1.2": "2026-11-01T12:00:00Z" } }]);
    mocks.advisory.findMany.mockResolvedValue([]);
    mocks.batch.create.mockResolvedValue({ id: "batch1" });
    mocks.batch.findFirst.mockResolvedValue(null);
    mocks.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({ dependencyBatch: mocks.batch, dependencyJob: mocks.job }));
  });

  it("legt einen Job pro Dienst an, alle im selben Lauf und mit direkt startender Analyse", async () => {
    const result = await createDependencyBatch({}, form(["app1|next@16.4.6", "app1|zod@4.1.2", "app2|next@16.4.6"]));
    expect(result).toMatchObject({ ok: true, batchId: "batch1", skipped: [] });
    expect(mocks.batch.create).toHaveBeenCalledOnce();
    expect(mocks.job.create).toHaveBeenCalledTimes(2);
    const first = mocks.job.create.mock.calls[0][0].data;
    expect(first).toMatchObject({ applicationId: "app1", batchId: "batch1", status: "ANALYZING", engine: "CLAUDE" });
    expect(first.packages.map((p: { name: string }) => p.name)).toEqual(["next", "zod"]);
    expect(german(first.messages.create[1].content)).toMatch(/Sammel-Updates über 2 Dienste/);
  });

  it("überspringt Dienste, die eine Prüfung nicht bestehen, und nennt sie mit Grund", async () => {
    mocks.job.findFirst.mockImplementation(({ where }: { where: { applicationId: string } }) => Promise.resolve(where.applicationId === "app2" ? { id: "open" } : null));
    const result = await createDependencyBatch({}, form(["app1|next@16.4.6", "app2|next@16.4.6"]));
    expect(result.ok).toBe(true);
    expect(mocks.job.create).toHaveBeenCalledOnce();
    expect(result.skipped).toEqual([{ name: "Wrap", message: expect.any(String) }]);
  });

  it("lässt Dienste ohne Auto-Deploy draußen und nennt den Grund", async () => {
    mocks.app.findMany.mockResolvedValue([{ id: "app1", name: "Chat", autoDeploy: false }, { id: "app2", name: "Wrap", autoDeploy: null }]);
    const result = await createDependencyBatch({}, form(["app1|next@16.4.6", "app2|next@16.4.6"]));
    expect(result.ok).toBe(true);
    expect(mocks.job.create).toHaveBeenCalledOnce();
    expect(mocks.job.create.mock.calls[0][0].data.applicationId).toBe("app2");
    expect(result.skipped).toEqual([{ name: "Chat", message: expect.any(String) }]);
    expect(german(result.skipped![0].message)).toMatch(/nicht automatisch/);
  });

  it("legt keinen leeren Lauf an, wenn kein Dienst starten kann", async () => {
    mocks.job.findFirst.mockResolvedValue({ id: "open" });
    const result = await createDependencyBatch({}, form(["app1|next@16.4.6"]));
    expect(german(result)).toMatchObject({ ok: false, message: "Kein Dienst konnte starten." });
    expect(mocks.batch.create).not.toHaveBeenCalled();
  });

  it("startet keinen zweiten Lauf, solange einer offen ist", async () => {
    mocks.batch.findFirst.mockResolvedValue({ id: "running" });
    expect(await createDependencyBatch({}, form(["app1|next@16.4.6"]))).toMatchObject({ ok: false, batchId: "running" });
    expect(mocks.batch.create).not.toHaveBeenCalled();
  });

  it("prüft die Engine vor allem anderen", async () => {
    const result = await createDependencyBatch({}, form(["app1|next@16.4.6"], "LOCAL_NODE"));
    expect(result.ok).toBe(false);
    expect(mocks.app.findFirst).not.toHaveBeenCalled();
  });
});
