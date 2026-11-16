import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ users: vi.fn(), logs: vi.fn(), createMany: vi.fn(), create: vi.fn(), update: vi.fn(), services: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: mocks.users }, dailyUpdateDigest: { findMany: mocks.logs, createMany: mocks.createMany, create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/services", () => ({ loadServices: mocks.services }));
vi.mock("@/lib/alert", () => ({ sendToChannel: mocks.send }));
import { groupDigest, htmlDigest, sendDueDailyUpdateDigests } from "./daily-update-digest";

const morning = new Date("2026-11-13T08:30:00Z"); // 09:30 in Berlin
beforeEach(() => {
  vi.resetAllMocks();
  mocks.users.mockResolvedValue([{ id: "u1", channels: [{ id: "c1" }] }]);
  mocks.send.mockResolvedValue({ success: true, detail: null });
});

describe("Tagesbericht", () => {
  it("rechnet nicht neu, wenn heute schon versendet wurde", async () => {
    mocks.logs.mockResolvedValue([{ channelId: "c1" }]);
    await sendDueDailyUpdateDigests(morning);
    expect(mocks.services).not.toHaveBeenCalled();
  });
  it("schickt keine Mail, wenn nichts offen ist, und merkt sich den Tag", async () => {
    mocks.logs.mockResolvedValue([]);
    mocks.services.mockResolvedValue({ services: [{ name: "Weedscore", candidates: [] }] });
    await sendDueDailyUpdateDigests(morning);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createMany).toHaveBeenCalled();
  });
  it("schickt bei offenen Updates genau eine Mail pro Kanal", async () => {
    mocks.logs.mockResolvedValue([]);
    mocks.services.mockResolvedValue({ services: [{ name: "Weedscore", candidates: [{ name: "sharp", from: "0.34.5", to: "0.35.5", security: true, critical: false }] }] });
    mocks.create.mockResolvedValue({});
    const result = await sendDueDailyUpdateDigests(morning);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
  });
});

describe("Tagesbericht: Minor-Empfehlungen", () => {
  it("kennzeichnet Minor-Updates, Sicherheit geht vor", () => {
    const html = htmlDigest([{ service: "example.com", packages: [
      { name: "framer-motion", from: "12.7.4", to: "12.43.0", security: false, minor: true },
      { name: "zod", from: "3.22.3", to: "4.6.7", security: true, minor: false },
      { name: "next", from: "16.4.5", to: "16.4.6", security: false, minor: false },
      { name: "typescript", from: "5.8.3", to: "7.0.2", security: false, minor: false, recommended: "Nativer Compiler, etwa 10× schneller" },
    ] }], morning);
    expect(html).toContain("Major, empfohlen: Nativer Compiler, etwa 10× schneller");
    expect(html.match(/>Minor</g)).toHaveLength(1);
    expect(html.match(/>Sicherheit</g)).toHaveLength(1);
  });
});

describe("Tagesbericht: gleiche Updates gruppiert", () => {
  const ts = (from: string) => ({ name: "typescript", from, to: "7.0.2", security: false, minor: false, recommended: "Nativer Compiler", hold: true, known: ["typescript-eslint unterstützt TS 7.0 nicht"] });
  const items = [
    { service: "Messenger", packages: [ts("5.9.3")] },
    { service: "Wizard", packages: [ts("5.7.3")] },
    { service: "Pilot", packages: [ts("5.9.3"), { name: "prisma", from: "5.22.0", to: "7.10.1", security: false, minor: false }] },
  ];
  it("zieht dasselbe Update aus mehreren Diensten zusammen, Abweichler mit Ausgangsversion", () => {
    const { shared, single } = groupDigest(items);
    expect(shared).toHaveLength(1);
    expect(shared[0].from).toBe("5.9.3");
    expect(shared[0].services.map((s) => s.service)).toEqual(["Messenger", "Wizard", "Pilot"]);
    expect(single).toEqual([{ service: "Pilot", packages: [items[2].packages[1]] }]);
  });
  it("nennt das Problem einmal, die Dienste darunter, und sagt abwarten statt empfohlen", () => {
    const html = htmlDigest(items, morning);
    expect(html.match(/Bekanntes Problem:/g)).toHaveLength(1);
    expect(html).toContain("In 3 Diensten: Messenger, Wizard (von 5.7.3), Pilot");
    expect(html).toContain("Major, abwarten: Nativer Compiler");
    expect(html).not.toContain("Major, empfohlen");
  });
});
