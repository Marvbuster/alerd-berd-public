// @vitest-environment jsdom
import React from "react";
import { cleanup, screen, within } from "@testing-library/react";
import { render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { VizNode } from "@/lib/viz";
vi.mock("@/components/useLiveNodes", () => ({ useLiveNodes: (initial: VizNode[]) => initial }));
vi.mock("@/lib/actions", () => ({ toggleMonitor: vi.fn(), checkNow: vi.fn() }));
import { RegistryLive } from "./RegistryLive";

const node = (id: string, status: VizNode["status"]): VizNode => ({
  id, label: id, kind: "PUSH", target: `${id}.invalid`, status, responseMs: null, intervalSec: 60, enabled: true,
  stateSinceMs: null, uptimeSec: null, uptimeAtMs: null, lastCheckedMs: null, lastUpMs: null, phase: 0, history: [{ t: 1, ms: null, status }], version: null,
  components: [{ name: "database", status: status === "UP" ? "ok" : "degraded" }], metrics: [], packages: [], coolifyApps: [], commit: null,
});
afterEach(() => cleanup());
it("shows exceptional component checks while keeping all monitor details reachable", () => {
  render(<RegistryLive initial={[node("Healthy", "UP"), node("Warning", "DEGRADED")]} showAlerting={false} canEdit={true} />);
  expect(screen.queryByRole("button", { name: "database: ok" })).toBeNull();
  expect(screen.getByRole("button", { name: "database: degraded" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Healthy" }).getAttribute("href")).toBe("/monitors/Healthy");
  const healthy = screen.getByRole("link", { name: "Healthy" }).closest("tr")!;
  expect(within(healthy).getByRole("img", { name: "Status der letzten 1 Checks" }).firstElementChild?.getAttribute("style")).toContain("var(--up)");
});
it("combines monitor search and status filtering", async () => {
  render(<RegistryLive initial={[node("Healthy", "UP"), node("Warning", "DEGRADED")]} showAlerting={false} canEdit={false} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Status filtern"), "DEGRADED");
  expect(screen.queryByRole("link", { name: "Healthy" })).toBeNull();
  expect(screen.getByRole("link", { name: "Warning" })).toBeTruthy();
  await user.type(screen.getByRole("searchbox"), "no-match");
  expect(screen.getByText("Keine Monitore für diesen Filter.")).toBeTruthy();
});
