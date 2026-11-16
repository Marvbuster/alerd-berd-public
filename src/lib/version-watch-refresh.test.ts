import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), upsert: vi.fn(), watched: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { packageRegistry: { findUnique: mocks.find, upsert: mocks.upsert }, watchedPackage: { findMany: mocks.watched } } }));
vi.mock("./alert", () => ({ ownerChannels: vi.fn(), sendToChannel: vi.fn() }));
import { refreshReferenceData } from "./version-watch";

const now = new Date("2026-11-11T12:00:00Z");
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock);
  mocks.find.mockResolvedValue({ npmFetchedAt: new Date(now.getTime() - 60 * 60_000), advisoriesFetchedAt: now, lastError: null });
  mocks.watched.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the daily background cadence", async () => {
  await refreshReferenceData(now);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("manual checks refresh older npm releases without re-fetching fresh advisories", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ "dist-tags": { latest: "16.4.6" }, time: { "16.4.6": now.toISOString(), "16.4.7-canary.0": now.toISOString() } })));
  await refreshReferenceData(now, 5 * 60_000);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe("https://registry.npmjs.org/next");
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { distTags: { latest: "16.4.6" }, versions: { "16.4.6": now.toISOString() }, npmFetchedAt: now } }));
});
it("reuses references from the previous five minutes", async () => {
  mocks.find.mockResolvedValue({ npmFetchedAt: new Date(now.getTime() - 60_000), advisoriesFetchedAt: now });
  await refreshReferenceData(now, 5 * 60_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("retains the previous registry snapshot on a failed npm request", async () => {
  fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
  await refreshReferenceData(now, 5 * 60_000);
  expect(mocks.upsert).toHaveBeenCalledOnce();
  expect(mocks.upsert.mock.calls[0][0].update).toEqual({ lastError: expect.stringContaining("npm 503") });
});
