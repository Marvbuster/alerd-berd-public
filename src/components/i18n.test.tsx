// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { render } from "@/test/render";
import { AppNavigation, SettingsLink } from "./AppNavigation";
import { PushButton } from "./PushButton";

vi.mock("next/navigation", () => ({ usePathname: () => "/services" }));
afterEach(cleanup);

it("shows the English navigation and push action with the real provider", () => {
  render(<><AppNavigation /><SettingsLink /><PushButton /></>, { locale: "en" });
  expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Services/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Queue/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Enable push on this device" })).toBeTruthy();
});
it("keeps the original German labels", () => {
  render(<AppNavigation />);
  expect(screen.getByRole("link", { name: /Dienste/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Warteschlange/ })).toBeTruthy();
});
