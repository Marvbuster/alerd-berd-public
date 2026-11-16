import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), revalidatePath: vi.fn(),
  connection: { deleteMany: vi.fn(), upsert: vi.fn() },
  application: { findFirst: vi.fn(), updateMany: vi.fn() }, monitor: { findFirst: vi.fn() },
  link: { upsert: vi.fn(), deleteMany: vi.fn() }, sync: vi.fn(),
  fetchApps: vi.fn(), encrypt: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/prisma", () => ({ prisma: { coolifyConnection: mocks.connection, coolifyApplication: mocks.application, monitor: mocks.monitor, monitorCoolifyApplication: mocks.link } }));
vi.mock("@/lib/coolify", () => ({ syncCoolifyConnection: mocks.sync }));
vi.mock("@/lib/coolify-client", () => ({ coolifyBaseUrl: (url: string) => `${url}/api/v1`, fetchCoolifyApplications: mocks.fetchApps }));
vi.mock("@/lib/credentials", () => ({ encryptCredential: mocks.encrypt }));
import { deleteConnection, linkMonitor, saveConnection, setApplicationHidden, syncConnection, unlinkMonitor } from "./actions";

beforeEach(() => { vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: "alice" }); });

describe("Coolify actions ownership", () => {
  it("accepts a plain token and a name with or without spaces", async () => {
    mocks.encrypt.mockReturnValue("encrypted-token");
    mocks.fetchApps.mockResolvedValue([]);
    mocks.connection.upsert.mockResolvedValue({ id: "connection" });
    mocks.sync.mockResolvedValue({ ok: true, message: "verbunden" });
    for (const name of ["Example", "Mein Coolify"]) {
      const form = new FormData();
      form.set("label", name); form.set("token", "1|synthetic-test-token"); form.set("baseUrl", "https://coolify.example.com");
      expect((await saveConnection({}, form)).ok).toBe(true);
      expect(mocks.connection.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ create: expect.objectContaining({ label: name, tokenEncrypted: "encrypted-token" }) }));
    }
  });
  it("distinguishes missing fields and invalid tokens without echoing credentials", async () => {
    const form = new FormData();
    expect((await saveConnection({}, form)).message).toContain("Verbindungsname");
    form.set("label", "Example");
    expect((await saveConnection({}, form)).message).toContain("Token wurde nicht übermittelt");
    form.set("token", "Bearer synthetic-secret");
    const result = await saveConnection({}, form);
    expect(result.message).toContain("Leerzeichen");
    expect(result.message).not.toContain("synthetic-secret");
    expect(mocks.fetchApps).not.toHaveBeenCalled();
  });
  it("requires login for all mutations", async () => {
    mocks.requireUser.mockRejectedValue(new Error("login"));
    for (const action of [() => saveConnection({}, new FormData()), () => syncConnection("app", {}, new FormData()), () => deleteConnection("id"), () => unlinkMonitor("app", "monitor"), () => linkMonitor("app", {}, new FormData()), () => setApplicationHidden("app", true, {}, new FormData())]) {
      await expect(action()).rejects.toThrow("login");
    }
    expect(mocks.link.upsert).not.toHaveBeenCalled();
    expect(mocks.connection.deleteMany).not.toHaveBeenCalled();
    expect(mocks.application.updateMany).not.toHaveBeenCalled();
  });
  it("rejects linking a foreign app or monitor", async () => {
    const form = new FormData(); form.set("monitorId", "monitor");
    for (const [app, monitor] of [[null, { id: "monitor" }], [{ id: "app" }, null]]) {
      mocks.application.findFirst.mockResolvedValue(app);
      mocks.monitor.findFirst.mockResolvedValue(monitor);
      expect((await linkMonitor("app", {}, form)).ok).toBe(false);
    }
    expect(mocks.application.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "app", missingSince: null, hiddenAt: null, connection: { ownerId: "alice" } } }));
    expect(mocks.monitor.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "monitor", ownerId: "alice" } }));
    expect(mocks.link.upsert).not.toHaveBeenCalled();
  });
  it("supports idempotent own links and scopes deletion on both sides", async () => {
    mocks.application.findFirst.mockResolvedValue({ id: "app" });
    mocks.monitor.findFirst.mockResolvedValue({ id: "monitor" });
    const form = new FormData(); form.set("monitorId", "monitor");
    expect((await linkMonitor("app", {}, form)).ok).toBe(true);
    await unlinkMonitor("app", "monitor");
    expect(mocks.link.deleteMany).toHaveBeenCalledWith({ where: { applicationId: "app", monitorId: "monitor", monitor: { ownerId: "alice" }, application: { connection: { ownerId: "alice" } } } });
    await deleteConnection("id");
    expect(mocks.connection.deleteMany).toHaveBeenCalledWith({ where: { id: "id", ownerId: "alice" } });
  });
  it("hides and restores only owned apps without deleting apps, monitors or links", async () => {
    mocks.application.updateMany.mockResolvedValue({ count: 1 });
    expect((await setApplicationHidden("app", true, {}, new FormData())).ok).toBe(true);
    expect(mocks.application.updateMany).toHaveBeenLastCalledWith({ where: { id: "app", connection: { ownerId: "alice" } }, data: { hiddenAt: expect.any(Date) } });
    expect((await setApplicationHidden("app", false, {}, new FormData())).ok).toBe(true);
    expect(mocks.application.updateMany).toHaveBeenLastCalledWith({ where: { id: "app", connection: { ownerId: "alice" } }, data: { hiddenAt: null } });
    expect(mocks.link.deleteMany).not.toHaveBeenCalled();
    expect(mocks.connection.deleteMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/versions");
  });
  it("rejects unknown or foreign apps and malformed visibility actions", async () => {
    mocks.application.updateMany.mockResolvedValue({ count: 0 });
    expect((await setApplicationHidden("foreign", true, {}, new FormData())).ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    mocks.application.updateMany.mockClear();
    expect((await setApplicationHidden("app", "false" as unknown as boolean, {}, new FormData())).ok).toBe(false);
    expect(mocks.application.updateMany).not.toHaveBeenCalled();
  });
});
