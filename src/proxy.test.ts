import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { LOCALE_HEADER } from "./i18n/locale";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), findUser: vi.fn() }));
vi.mock("@/lib/jwt", () => ({ SESSION_COOKIE: "session", verifySession: mocks.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
import { proxy } from "./proxy";

function request(path = "/services", cookie = "", language = "de", header = "de") {
  return new NextRequest(`https://example.com${path}`, { headers: { cookie, "accept-language": language, "x-alerd-locale": header } });
}
const forwardedLocale = (response: Awaited<ReturnType<typeof proxy>>) => response.headers.get(`x-middleware-request-${LOCALE_HEADER}`);
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("ALERD_DEFAULT_LOCALE", "en");
  mocks.verify.mockResolvedValue({ userId: "u1" });
  mocks.findUser.mockResolvedValue({ active: true, locale: "en" });
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy locale selection", () => {
  it("keeps public liveness independent of authentication and the database", async () => {
    expect((await proxy(request("/api/health", "session=token"))).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("prefers the locale cookie and replaces a supplied internal header", async () => {
    expect(forwardedLocale(await proxy(request("/services", "session=token; alerd-locale=en")))).toBe("en");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("uses the active account before the browser preference", async () => {
    expect(forwardedLocale(await proxy(request("/services", "session=token")))).toBe("en");
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: "u1" }, select: { locale: true, active: true } });
  });
  it("remembers the account locale in a cookie so polls skip the database", async () => {
    const saved = (await proxy(request("/services", "session=token"))).cookies.get("alerd-locale");
    expect(saved?.value).toBe("en");
    expect(saved?.maxAge).toBe(365 * 86_400);
    mocks.findUser.mockResolvedValue({ active: true, locale: null });
    const guessed = (await proxy(request("/services", "session=token", "de"))).cookies.get("alerd-locale");
    expect(guessed?.value).toBe("de");
    expect(guessed?.maxAge).toBe(86_400);
  });
  it("ignores inactive accounts and unsupported browser languages", async () => {
    mocks.findUser.mockResolvedValue({ active: false, locale: "de" });
    expect(forwardedLocale(await proxy(request("/services", "session=token", "fr")))).toBe("en");
  });
  it("localizes the login page without querying an anonymous account", async () => {
    expect(forwardedLocale(await proxy(request("/login", "", "de-CH,en;q=0.5", "en")))).toBe("de");
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
  it("preserves unauthorized API responses", async () => {
    expect((await proxy(request("/api/queue"))).status).toBe(401);
  });
});
