import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coolifyBaseUrl, fetchCoolifyApplications, parseCoolifyApplications, parseCoolifyEnvKeys } from "./coolify-client";

beforeEach(() => vi.stubEnv("COOLIFY_ALLOWED_ORIGINS", "https://coolify.example.com,http://coolify:8080"));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Coolify read-only boundary", () => {
  it("only accepts an explicitly allowed origin and the fixed API path", () => {
    expect(coolifyBaseUrl("https://coolify.example.com/")).toBe("https://coolify.example.com/api/v1");
    expect(coolifyBaseUrl("http://coolify:8080/api/v1")).toBe("http://coolify:8080/api/v1");
    for (const value of ["http://169.254.169.254", "https://other.example.com", "https://coolify.example.com.evil.test", "https://token@coolify.example.com", "https://coolify.example.com/api/v1/deploy", "https://coolify.example.com?token=x", "file:///etc/passwd"]) {
      expect(() => coolifyBaseUrl(value)).toThrow();
    }
    vi.stubEnv("COOLIFY_ALLOWED_ORIGINS", "");
    expect(() => coolifyBaseUrl("https://coolify.example.com")).toThrow();
  });
  it("discards secrets and credential-bearing repositories", () => {
    const [app] = parseCoolifyApplications([{ uuid: "abc", name: "App", git_commit_sha: "HEAD", git_repository: "https://secret@github.com/a/b", manual_webhook_secret_github: "secret", fqdn: "https://user:pass@app.test/path?token=secret" }]);
    expect(app.repository).toBeNull();
    expect(app.reportedCommit).toBeNull();
    expect(app.domains).toBe("https://app.test");
    expect(JSON.stringify(app)).not.toContain("secret");
    expect(parseCoolifyApplications([{ uuid: "abc", name: "App", git_repository: "git@github.com:owner/repo.git" }])[0].repository).toBe("git@github.com:owner/repo.git");
  });
  it("liest die Domains von Docker-Compose-Apps aus docker_compose_domains", () => {
    const compose = JSON.stringify({ matomo: { domain: "https://stats.example.com,https://matomo.example.com/x" }, db: { domain: "" }, junk: { domain: "ftp://x" } });
    expect(parseCoolifyApplications([{ uuid: "m", name: "Matomo", fqdn: null, docker_compose_domains: compose }])[0].domains).toBe("https://stats.example.com, https://matomo.example.com");
    expect(parseCoolifyApplications([{ uuid: "m", name: "M", fqdn: "https://a.test", docker_compose_domains: { web: { domain: "https://a.test" } } }])[0].domains).toBe("https://a.test");
    expect(parseCoolifyApplications([{ uuid: "m", name: "M", docker_compose_domains: "kein json" }])[0].domains).toBeNull();
  });
  it("rejects partial, wrapped, duplicate, or oversized inventory instead of marking apps missing", () => {
    for (const value of [{ data: [] }, [{ name: "missing ID" }], [{ uuid: "abc", name: "A" }, { uuid: "abc", name: "B" }], Array(2001).fill({})]) expect(() => parseCoolifyApplications(value)).toThrow();
    expect(parseCoolifyApplications([])).toEqual([]);
  });
  it("uses one fixed GET, forbids redirects and never surfaces upstream error bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ uuid: "abc", name: "A" }])));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchCoolifyApplications("https://coolify.example.com", "sensitive")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("https://coolify.example.com/api/v1/applications", expect.objectContaining({ method: "GET", redirect: "error", headers: expect.objectContaining({ authorization: "Bearer sensitive" }) }));
    fetcher.mockResolvedValue(new Response("reflected sensitive token", { status: 401 }));
    await expect(fetchCoolifyApplications("https://coolify.example.com", "sensitive")).rejects.toThrow("Coolify HTTP 401");
    fetcher.mockResolvedValue(new Response("x".repeat(4_000_001)));
    await expect(fetchCoolifyApplications("https://coolify.example.com", "sensitive")).rejects.toThrow("Größenlimit");
  });
});

describe("parseCoolifyEnvKeys", () => {
  it("liefert nur Namen ohne Coolify-Variablen und Previews", () => {
    expect(parseCoolifyEnvKeys([
      { key: "DATABASE_URI", value: "mongodb://geheim" }, { key: "PAYLOAD_SECRET", value: "x" },
      { key: "DATABASE_URI", is_preview: true }, { key: "SERVICE_FQDN_APP" }, { key: "bad-name" },
    ])).toEqual(["DATABASE_URI", "PAYLOAD_SECRET"]);
  });
});
