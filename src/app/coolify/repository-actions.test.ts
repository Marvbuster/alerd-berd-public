import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), app: { findFirst: vi.fn() }, watch: { upsert: vi.fn() }, snapshot: { deleteMany: vi.fn() },
  credential: { upsert: vi.fn(), deleteMany: vi.fn() }, transaction: vi.fn(), encrypt: vi.fn(), scan: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { coolifyApplication: mocks.app, repositoryWatch: mocks.watch, repositorySnapshot: mocks.snapshot, gitHubCredential: mocks.credential, $transaction: mocks.transaction } }));
vi.mock("@/lib/credentials", () => ({ encryptCredential: mocks.encrypt }));
vi.mock("@/lib/repository-watch", () => ({ scanRepository: mocks.scan }));
vi.mock("@/lib/version-watch", () => ({ refreshReferenceData: mocks.refresh }));
const expiry = { expiresAt: new Date("2027-01-14T12:00:00Z"), expiryCheckedAt: new Date("2026-11-14T12:00:00Z"), expiryWarnedDays: null };
vi.mock("@/lib/credential-expiry-watch", () => ({ expiryOrRetry: vi.fn(async (token: string) => (token === "revoked" ? "invalid" : expiry)) }));
import { saveRepository, saveGitHubCredential, deleteGitHubCredential, scanRepositoryNow } from "./repository-actions";

beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "alice" });
  mocks.transaction.mockImplementation((fn) => fn({ repositoryWatch: mocks.watch, repositorySnapshot: mocks.snapshot }));
});
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ repository: "owner/repo", branch: "main", manifestPath: "apps/web/package.json", lockfilePath: "package-lock.json" })) data.set(key, value);
  return data;
};

describe("repository actions", () => {
  it("authenticates every action", async () => {
    mocks.user.mockRejectedValue(new Error("login"));
    for (const action of [() => saveRepository("app", {}, form()), () => saveGitHubCredential({}, new FormData()), () => deleteGitHubCredential(), () => scanRepositoryNow("watch", {}, new FormData())]) await expect(action()).rejects.toThrow("login");
  });
  it("checks application ownership before creating or scanning a watch", async () => {
    mocks.app.findFirst.mockResolvedValue(null);
    expect((await saveRepository("foreign", {}, form())).ok).toBe(false);
    expect(mocks.app.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", missingSince: null, hiddenAt: null, connection: { ownerId: "alice" } } }));
    expect(mocks.watch.upsert).not.toHaveBeenCalled(); expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("saves config and invalidates old snapshots without starting a scan", async () => {
    mocks.app.findFirst.mockResolvedValue({ id: "app" });
    mocks.watch.upsert.mockResolvedValue({ id: "watch" });
    mocks.scan.mockResolvedValue({ ok: true });
    expect((await saveRepository("app", {}, form())).ok).toBe(true);
    expect(mocks.watch.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ revision: expect.any(String), syncLockedUntil: null }) }));
    expect(mocks.snapshot.deleteMany).toHaveBeenCalledWith({ where: { watchId: "watch" } });
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("refreshes npm references only after a successful owner-scoped manual scan", async () => {
    mocks.scan.mockResolvedValueOnce({ ok: false, message: "unavailable" });
    await scanRepositoryNow("watch", {}, new FormData());
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.scan.mockResolvedValueOnce({ ok: true });
    await scanRepositoryNow("watch", {}, new FormData());
    expect(mocks.scan).toHaveBeenLastCalledWith("watch", "alice");
    expect(mocks.refresh).toHaveBeenCalledWith(expect.any(Date), 5 * 60_000);
  });
  it("stores only owner-bound ciphertext and never reflects the token", async () => {
    mocks.encrypt.mockReturnValue("encrypted");
    const data = new FormData(); data.set("token", "synthetic-secret");
    const result = await saveGitHubCredential({}, data);
    expect(mocks.encrypt).toHaveBeenCalledWith("synthetic-secret", "alice:github");
    expect(mocks.credential.upsert).toHaveBeenCalledWith({ where: { ownerId: "alice" }, create: { ownerId: "alice", tokenEncrypted: "encrypted", ...expiry }, update: { tokenEncrypted: "encrypted", ...expiry } });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    await deleteGitHubCredential(); expect(mocks.credential.deleteMany).toHaveBeenCalledWith({ where: { ownerId: "alice" } });
  });
  it("lehnt einen Token ab, den GitHub nicht annimmt", async () => {
    mocks.credential.upsert.mockClear();
    const data = new FormData(); data.set("token", "revoked");
    const result = await saveGitHubCredential({}, data);
    expect(result.ok).toBe(false);
    expect(mocks.credential.upsert).not.toHaveBeenCalled();
  });
});
