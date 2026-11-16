import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), update: vi.fn(), set: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: mocks.update } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { setLocale } from "./locale-actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "signed-in-user" });
  mocks.update.mockResolvedValue({});
});
it("persists the signed-in account and cookie and refreshes the layout", async () => {
  const form = new FormData();
  form.set("locale", "en");
  form.set("userId", "someone-else");
  await setLocale(form);
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "signed-in-user" }, data: { locale: "en" } });
  expect(mocks.set).toHaveBeenCalledWith("alerd-locale", "en", expect.objectContaining({ path: "/", httpOnly: true, sameSite: "lax" }));
  expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
});
it("rejects unsupported locales without changing either preference", async () => {
  const form = new FormData();
  form.set("locale", "fr");
  await setLocale(form);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});
it("does not set a cookie if account persistence fails", async () => {
  mocks.update.mockRejectedValue(new Error("database unavailable"));
  const form = new FormData();
  form.set("locale", "de");
  await expect(setLocale(form)).rejects.toThrow("database unavailable");
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
