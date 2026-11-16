import { afterEach, expect, it, vi } from "vitest";
const scan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/repository-watch", () => ({ scanDueRepositories: scan }));
import { POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); scan.mockReset(); });

it("requires a configured, exact scheduler secret", async () => {
  for (const secret of ["", "configured-secret"]) {
    vi.stubEnv("RUN_CHECKS_SECRET", secret);
    for (const authorization of ["", "Bearer wrong"]) {
      expect((await POST(new Request("https://alerd.test/api/repositories/sync", { method: "POST", headers: { authorization } }))).status).toBe(401);
    }
  }
  expect(scan).not.toHaveBeenCalled();
});

it("returns only aggregate counts, never private repo metadata", async () => {
  vi.stubEnv("RUN_CHECKS_SECRET", "configured-secret");
  scan.mockResolvedValue([{ ok: true, message: "private SHA" }, { ok: false, message: "private repo" }]);
  const response = await POST(new Request("https://alerd.test/api/repositories/sync", { method: "POST", headers: { authorization: "Bearer configured-secret" } }));
  expect(await response.json()).toEqual({ scanned: 1, failed: 1 });
});
