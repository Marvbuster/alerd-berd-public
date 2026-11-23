import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { updateMany: vi.fn(), findFirstOrThrow: vi.fn(), findMany: vi.fn() },
  apps: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  fetchApps: vi.fn(), fetchAutoDeploy: vi.fn(), decrypt: vi.fn(), transaction: vi.fn(),
}));
vi.mock("./prisma", () => ({ prisma: { coolifyConnection: mocks.connection, coolifyApplication: mocks.apps, $transaction: mocks.transaction } }));
vi.mock("./credentials", () => ({ decryptCredential: mocks.decrypt }));
vi.mock("./coolify-client", () => ({ fetchCoolifyApplications: mocks.fetchApps, fetchCoolifyAutoDeploy: mocks.fetchAutoDeploy }));
import { syncCoolifyConnection, syncDueCoolifyConnections } from "./coolify";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.updateMany.mockResolvedValue({ count: 1 });
  mocks.connection.findFirstOrThrow.mockResolvedValue({ baseUrl: "https://coolify.test/api/v1", tokenEncrypted: "ciphertext" });
  mocks.decrypt.mockReturnValue("token");
  mocks.fetchApps.mockResolvedValue([{ uuid: "abc", name: "App" }]);
  mocks.apps.findMany.mockResolvedValue([]);
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
  it("liest Auto-Deploy nur für Dienste und behält den alten Wert, wenn die Abfrage scheitert", async () => {
    mocks.fetchApps.mockResolvedValue([{ uuid: "abc", name: "App" }, { uuid: "def", name: "Other" }, { uuid: "ghi", name: "Pool" }]);
    mocks.apps.findMany.mockResolvedValue([{ uuid: "abc" }, { uuid: "def" }]);
    mocks.fetchAutoDeploy.mockImplementation((_b: string, _t: string, uuid: string) => uuid === "abc" ? Promise.resolve(false) : Promise.reject(new Error("timeout")));
    expect((await syncCoolifyConnection("id", "owner")).ok).toBe(true);
    expect(mocks.apps.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ connectionId: "id", serviceAt: { not: null } }) }));
    expect(mocks.fetchAutoDeploy).toHaveBeenCalledTimes(2);
    const [abc, def, ghi] = mocks.apps.upsert.mock.calls.map((c) => c[0]);
    expect(abc.update.autoDeploy).toBe(false);
    expect(def.update).not.toHaveProperty("autoDeploy");
    expect(ghi.update).not.toHaveProperty("autoDeploy");
    expect(ghi.create.autoDeploy).toBeNull();
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
