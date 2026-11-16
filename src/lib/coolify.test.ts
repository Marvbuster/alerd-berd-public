import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn() },
  apps: { upsert: vi.fn(), updateMany: vi.fn() },
  fetchApps: vi.fn(), decrypt: vi.fn(), transaction: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: { coolifyConnection: mocks.connection, coolifyApplication: mocks.apps, $transaction: mocks.transaction } }));
vi.mock("./credentials", () => ({ decryptCredential: mocks.decrypt }));
vi.mock("./coolify-client", () => ({ fetchCoolifyApplications: mocks.fetchApps }));
import { syncCoolifyConnection, syncDueCoolifyConnections } from "./coolify";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.updateMany.mockResolvedValue({ count: 1 });
  mocks.connection.findFirstOrThrow.mockResolvedValue({ baseUrl: "https://coolify.test/api/v1", tokenEncrypted: "ciphertext" });
  mocks.decrypt.mockReturnValue("token");
  mocks.fetchApps.mockResolvedValue([{ uuid: "abc", name: "App" }]);
  mocks.transaction.mockImplementation((fn) => fn({ coolifyConnection: mocks.connection, coolifyApplication: mocks.apps }));
});

describe("Coolify inventory persistence", () => {
  it("scopes claims to owner and does not fetch if already running or not owned", async () => {
    mocks.connection.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await syncCoolifyConnection("id", "owner")).ok).toBe(false);
    expect(mocks.connection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "id", ownerId: "owner" }) }));
    expect(mocks.fetchApps).not.toHaveBeenCalled();
  });
  it("upserts stable identities and marks missing apps without deleting their mappings", async () => {
    expect((await syncCoolifyConnection("id", "owner")).ok).toBe(true);
    expect(mocks.decrypt).toHaveBeenCalledWith("ciphertext", "owner:https://coolify.test/api/v1");
    expect(mocks.apps.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId_uuid: { connectionId: "id", uuid: "abc" } }, update: expect.objectContaining({ missingSince: null }) }));
    expect(mocks.apps.upsert.mock.calls[0][0].update).not.toHaveProperty("hiddenAt");
    expect(mocks.apps.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: "id", uuid: { notIn: ["abc"] }, missingSince: null } }));
  });
  it("preserves last successful inventory on failure and releases the lease", async () => {
    mocks.fetchApps.mockRejectedValue(new Error("contains secret-token"));
    const result = await syncCoolifyConnection("id", "owner");
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("secret-token");
    expect(mocks.apps.updateMany).not.toHaveBeenCalled();
    expect(mocks.connection.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { syncLockedUntil: null } }));
  });
  it("does not commit a stale lease", async () => {
    mocks.connection.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await syncCoolifyConnection("id", "owner")).ok).toBe(false);
    expect(mocks.apps.upsert).not.toHaveBeenCalled();
  });
  it("schedules only active owners with a bounded cooldown batch", async () => {
    mocks.connection.findMany.mockResolvedValue([]);
    await syncDueCoolifyConnections();
    expect(mocks.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ owner: { active: true } }), take: 10 }));
  });
});
