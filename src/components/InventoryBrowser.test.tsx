// @vitest-environment jsdom
import React from "react";
import { cleanup, screen, within } from "@testing-library/react";
import { render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InventoryBrowser, type InventoryItem } from "./InventoryBrowser";

const items: InventoryItem[] = [
  { id: "a", name: "Alpha", domains: "https://alpha.invalid", repository: "owner/alpha", status: "running:healthy", group: "linked", hidden: false, monitorNames: ["Alpha Health"], version: "16.4.5", comparison: "match", detail: <article id="app-a">Alpha-Details</article> },
  { id: "b", name: "Beta", domains: null, repository: "owner/beta", status: "running:unhealthy", group: "unlinked", hidden: false, monitorNames: [], version: null, comparison: null, detail: <article id="app-b">Beta-Details</article> },
];
beforeEach(() => {
  window.history.replaceState(null, "", "/coolify");
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => cleanup());
it("selects a deep-linked app and updates selection without duplicating its details", async () => {
  window.history.replaceState(null, "", "/coolify#app-b");
  render(<InventoryBrowser items={items} initialView="all" initialQuery="" />);
  expect(screen.getAllByText("Beta-Details")).toHaveLength(1);
  expect(screen.queryByText("Alpha-Details")).toBeNull();
  await userEvent.setup().click(screen.getByRole("link", { name: "Details zu Alpha" }));
  expect(screen.getAllByText("Alpha-Details")).toHaveLength(1);
  expect(window.location.hash).toBe("#app-a");
});
it("filters immediately by repository or monitor, retaining the filter URL", async () => {
  render(<InventoryBrowser items={items} initialView="all" initialQuery="" />); const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox"), "owner/beta");
  expect(screen.queryByRole("link", { name: "Details zu Alpha" })).toBeNull();
  expect(screen.getByText("Beta-Details")).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("q")).toBe("owner/beta");
  await user.clear(screen.getByRole("searchbox"));
  await user.click(within(screen.getByRole("navigation", { name: "App-Ansicht" })).getByRole("link", { name: "Ohne Monitor 1" }));
  expect(screen.queryByRole("link", { name: "Details zu Alpha" })).toBeNull();
  expect(new URLSearchParams(window.location.search).get("view")).toBe("unlinked");
});
it("renders one inline inspector on mobile, without a second copy of its forms", () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const { container } = render(<InventoryBrowser items={items} initialView="all" initialQuery="" />);
  expect(container.querySelectorAll("#app-a")).toHaveLength(1);
  expect(container.querySelector(".inventory-mobile-detail #app-a")).toBeTruthy();
  expect(container.querySelector(".inventory-desktop-detail")).toBeNull();
});
it("discards editor state when switching to a different app", async () => {
  render(<InventoryBrowser items={items.map((item) => ({ ...item, detail: <input aria-label="Branch" defaultValue={item.id} /> }))} initialView="all" initialQuery="" />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Branch"), "-unsaved");
  await user.click(screen.getByRole("link", { name: "Details zu Beta" }));
  expect((screen.getByLabelText("Branch") as HTMLInputElement).value).toBe("b");
});
it("retains filters across refreshed inventory data after a server action", async () => {
  const { rerender } = render(<InventoryBrowser items={items} initialView="all" initialQuery="" />);
  const user = userEvent.setup();
  await user.click(within(screen.getByRole("navigation", { name: "App-Ansicht" })).getByRole("link", { name: "Ohne Monitor 1" }));
  window.history.replaceState(null, "", "/coolify");
  rerender(<InventoryBrowser items={[...items]} initialView="all" initialQuery="" />);
  expect(screen.queryByRole("link", { name: "Details zu Alpha" })).toBeNull();
  expect(new URLSearchParams(window.location.search).get("view")).toBe("unlinked");
});
it("excludes hidden apps from normal lists and counts and exposes a separate view", async () => {
  render(<InventoryBrowser items={[items[0], { ...items[1], hidden: true }]} initialView="all" initialQuery="" />);
  expect(screen.queryByRole("link", { name: "Details zu Beta" })).toBeNull();
  const tabs = within(screen.getByRole("navigation", { name: "App-Ansicht" }));
  expect(tabs.getByRole("link", { name: "Alle 1" })).toBeTruthy();
  expect(tabs.getByRole("link", { name: "Ohne Monitor 0" })).toBeTruthy();
  await userEvent.setup().click(tabs.getByRole("link", { name: "Ausgeblendet 1" }));
  expect(screen.getByRole("link", { name: "Details zu Beta" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Details zu Alpha" })).toBeNull();
  expect(new URLSearchParams(window.location.search).get("view")).toBe("hidden");
});
it("removes a just-hidden selected app from the current view without jumping to hidden apps", () => {
  const { rerender } = render(<InventoryBrowser items={items} initialView="all" initialQuery="" />);
  rerender(<InventoryBrowser items={[{ ...items[0], hidden: true }, items[1]]} initialView="all" initialQuery="" />);
  expect(screen.queryByText("Alpha-Details")).toBeNull();
  expect(screen.getByText("Beta-Details")).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("view")).toBeNull();
});
it("opens a hidden app when following an existing monitor backlink", () => {
  window.history.replaceState(null, "", "/coolify#app-b");
  render(<InventoryBrowser items={[items[0], { ...items[1], hidden: true }]} initialView="all" initialQuery="" />);
  expect(screen.getByText("Beta-Details")).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("view")).toBe("hidden");
});
it("keeps the restore view reachable when every app is hidden", () => {
  render(<InventoryBrowser items={items.map((item) => ({ ...item, hidden: true }))} initialView="all" initialQuery="" />);
  expect(screen.getByText(/Alle Apps sind ausgeblendet/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Ausgeblendet 2" })).toBeTruthy();
});
