import { afterEach, expect, it, vi } from "vitest";
const sync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/coolify", () => ({ syncDueCoolifyConnections: sync }));
import { POST } from "./route";
afterEach(() => { vi.unstubAllEnvs(); sync.mockReset(); });

it("fails closed for unset/missing/wrong scheduler secrets", async () => {
  for (const secret of ["", "expected-secret"]) {
    vi.stubEnv("RUN_CHECKS_SECRET", secret);
    for (const auth of ["", "Bearer wrong", "Bearer "]) {
      expect((await POST(new Request("https://alerd.test/api/coolify/sync", { method: "POST", headers: { authorization: auth } }))).status).toBe(401);
    }
  }
  expect(sync).not.toHaveBeenCalled();
});

it("accepts the exact scheduler bearer and returns no app or credential details", async () => {
  vi.stubEnv("RUN_CHECKS_SECRET", "expected-secret");
  sync.mockResolvedValue([{ ok: true, message: "private" }, { ok: false, message: "private" }]);
  const res = await POST(new Request("https://alerd.test/api/coolify/sync", { method: "POST", headers: { authorization: "Bearer expected-secret" } }));
  expect(await res.json()).toEqual({ synced: 1, failed: 1 });
});
