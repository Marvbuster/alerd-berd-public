import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepositoryDependencies } from "./github-client";

afterEach(() => vi.unstubAllGlobals());
const sha = "a".repeat(40);
const config = { repository: "owner/repo", branch: "release/stable", manifestPath: "apps/web/package.json", lockfilePath: "package-lock.json" };

describe("GitHub fixed-origin reads", () => {
  it("pins both raw JSON reads to one validated branch SHA and ignores upstream URLs", async () => {
    const manifest = { dependencies: { next: "^16.4.5" } };
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/git/ref/")) return Response.json({ ref: "refs/heads/release/stable", object: { type: "commit", sha, url: "https://evil.test/token" } });
      if (url.includes("package-lock.json")) return Response.json({ lockfileVersion: 3, packages: { "": {}, "apps/web": manifest, "node_modules/next": { version: "16.4.6" } } });
      return Response.json(manifest);
    });
    vi.stubGlobal("fetch", fetcher);
    const data = await fetchRepositoryDependencies(config, "private-token");
    expect(data).toMatchObject({ commitSha: sha, declaredVersion: "^16.4.5", lockedVersion: "16.4.6" });
    expect(data.manifestHash).toHaveLength(64);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, opts] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/owner\/repo\//);
      expect(opts).toMatchObject({ method: "GET", redirect: "error", headers: { authorization: "Bearer private-token" } });
      if (url.includes("/contents/")) expect(url).toContain(`?ref=${sha}`);
    }
  });
  it("parses pnpm-lock.yaml as YAML and refuses YAML aliases", async () => {
    const manifest = { dependencies: { next: "^16.4.5" } };
    const lock = ["lockfileVersion: '9.0'", "", "importers:", "", "  apps/web:", "    dependencies:", "      next:", "        specifier: ^16.4.5", "        version: 16.4.6(react@19.2.4)", ""].join("\n");
    const reply = (lockText: string) => vi.fn(async (url: string) => {
      if (url.includes("/git/ref/")) return Response.json({ ref: "refs/heads/release/stable", object: { type: "commit", sha } });
      if (url.includes("pnpm-lock.yaml")) return new Response(lockText);
      return Response.json(manifest);
    });
    vi.stubGlobal("fetch", reply(lock));
    expect(await fetchRepositoryDependencies({ ...config, lockfilePath: "pnpm-lock.yaml" }, null)).toMatchObject({ declaredVersion: "^16.4.5", lockedVersion: "16.4.6" });
    vi.stubGlobal("fetch", reply("a: &x [1]\nb: *x\n"));
    await expect(fetchRepositoryDependencies({ ...config, lockfilePath: "pnpm-lock.yaml" }, null)).rejects.toThrow("YAML");
  });
  it("rejects malformed branch observations and paths before reading contents", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ref: "refs/heads/other", object: { type: "commit", sha } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchRepositoryDependencies(config, null)).rejects.toThrow("eindeutigen");
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    await expect(fetchRepositoryDependencies({ ...config, lockfilePath: "../package-lock.json" }, null)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not reflect upstream error content or leak credentials on redirects/errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-token reflected", { status: 403 })));
    await expect(fetchRepositoryDependencies(config, "private-token")).rejects.toThrow("Contents-Leserechte");
    try { await fetchRepositoryDependencies(config, "private-token"); } catch (e) { expect(String(e)).not.toContain("private-token"); }
  });
});
