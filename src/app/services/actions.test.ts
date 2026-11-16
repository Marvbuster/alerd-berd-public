import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), app: { updateMany: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { coolifyApplication: mocks.app } }));
vi.mock("@/lib/check", () => ({ runCheckForMonitor: vi.fn() }));
vi.mock("@/lib/repository-watch", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/version-watch", () => ({ refreshReferenceData: vi.fn() }));
vi.mock("@/app/coolify/repository-actions", () => ({ saveRepository: vi.fn() }));
import { addServices } from "./actions";

beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "alice" }); });

const form = (ids: string[]) => { const f = new FormData(); for (const id of ids) f.append("applicationId", id); return f; };

describe("addServices", () => {
  // Die Inventur legt Apps mit randomUUID() an, also mit Bindestrichen.
  it("nimmt UUIDs aus der Coolify-Inventur an", async () => {
    mocks.app.updateMany.mockResolvedValue({ count: 2 });
    const ids = ["0f8c2d1e-3b4a-4c5d-8e9f-a0b1c2d3e4f5", "cm3abc1230000xyz987654321"];
    expect(await addServices({}, form(ids))).toEqual({ ok: true, ids });
    expect(mocks.app.updateMany.mock.calls[0][0].where.id).toEqual({ in: ids });
  });

  it("verwirft alles, was keine ID ist", async () => {
    expect(await addServices({}, form(["x", "a b c d e f g h", "../../etc"]))).toMatchObject({ ok: false });
    expect(mocks.app.updateMany).not.toHaveBeenCalled();
  });
});
