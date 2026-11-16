import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  watch: { updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn() },
  credential: { findUnique: vi.fn() }, snapshot: { upsert: vi.fn() }, transaction: vi.fn(), fetch: vi.fn(), decrypt: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: { repositoryWatch: mocks.watch, gitHubCredential: mocks.credential, repositorySnapshot: mocks.snapshot, $transaction: mocks.transaction } }));
vi.mock("./github-client", () => ({ fetchRepositoryDependencies: mocks.fetch }));
vi.mock("./credentials", () => ({ decryptCredential: mocks.decrypt }));
import { scanRepository, scanDueRepositories } from "./repository-watch";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.watch.updateMany.mockResolvedValue({ count: 1 });
  mocks.watch.findFirstOrThrow.mockResolvedValue({ id: "watch", revision: "revision", repository: "owner/repo" });
  mocks.credential.findUnique.mockResolvedValue(null);
  mocks.fetch.mockResolvedValue({ commitSha: "a".repeat(40), declaredVersion: "^16.4.5", lockedVersion: "16.4.6", dependencies: [], manifestHash: "hash", lockfileHash: "hash" });
  mocks.transaction.mockImplementation((fn) => fn({ repositoryWatch: mocks.watch, repositorySnapshot: mocks.snapshot }));
});

describe("repository scan boundaries", () => {
  it("does not fetch foreign, hidden, missing or locked watches", async () => {
    mocks.watch.updateMany.mockResolvedValue({ count: 0 });
    expect((await scanRepository("watch", "alice")).ok).toBe(false);
    expect(mocks.watch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ application: { missingSince: null, hiddenAt: null, connection: { ownerId: "alice" } } }) }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("uses only the current owners credential and can scan public repos without one", async () => {
    expect((await scanRepository("watch", "alice")).ok).toBe(true);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.anything(), null);
    mocks.credential.findUnique.mockResolvedValue({ tokenEncrypted: "encrypted" });
    mocks.decrypt.mockReturnValue("secret");
    await scanRepository("watch", "alice");
    expect(mocks.credential.findUnique).toHaveBeenLastCalledWith({ where: { ownerId: "alice" } });
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted", "alice:github");
    expect(mocks.snapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ watchId: "watch", lockedVersion: "16.4.6" }) }));
  });
  it("keeps known snapshots on failure and releases only its own lease", async () => {
    mocks.fetch.mockRejectedValue(new Error("GitHub HTTP 404: Repo fehlt."));
    expect((await scanRepository("watch", "alice")).ok).toBe(false);
    expect(mocks.snapshot.upsert).not.toHaveBeenCalled();
    expect(mocks.watch.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ revision: "revision", syncLockedUntil: expect.any(Date) }), data: { syncLockedUntil: null } }));
  });
  it("rejects a result from a replaced config or lease", async () => {
    mocks.watch.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await scanRepository("watch", "alice")).ok).toBe(false);
    expect(mocks.snapshot.upsert).not.toHaveBeenCalled();
  });
  it("schedules bounded scans for active owners with a cooldown", async () => {
    mocks.watch.findMany.mockResolvedValue([]);
    await scanDueRepositories();
    expect(mocks.watch.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, where: expect.objectContaining({ application: { missingSince: null, hiddenAt: null, connection: { owner: { active: true } } } }) }));
  });
});
