// @vitest-environment jsdom
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), scan: vi.fn() }));
vi.mock("@/app/coolify/repository-actions", () => ({ saveRepository: mocks.save, scanRepositoryNow: mocks.scan, saveGitHubCredential: vi.fn(), deleteGitHubCredential: vi.fn() }));
import { RepositoryPanel } from "./RepositoryForms";
const defaults = { repository: "owner/repo", branch: "main", manifestPath: "apps/web/package.json", lockfilePath: "package-lock.json" };
const panel = (watchId: string | undefined = "watch", lastError: string | null = null) => <RepositoryPanel applicationId="app" watchId={watchId} defaults={defaults} lastError={lastError} readOnly={false}><p>Versionsvergleich</p></RepositoryPanel>;
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows one scan action and edits config separately; cancel discards edits", async () => {
  render(panel()); const user = userEvent.setup();
  expect(screen.getByRole("button", { name: "Versionen prüfen" })).toBeTruthy();
  expect(screen.queryByLabelText("Branch")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Git-Einstellungen bearbeiten" }));
  expect(screen.queryByRole("button", { name: "Versionen prüfen" })).toBeNull();
  await user.clear(screen.getByLabelText("Branch")); await user.type(screen.getByLabelText("Branch"), "temporary");
  await user.click(screen.getByRole("button", { name: "Abbrechen" }));
  await user.click(screen.getByRole("button", { name: "Git-Einstellungen bearbeiten" }));
  expect((screen.getByLabelText("Branch") as HTMLInputElement).value).toBe("main");
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.scan).not.toHaveBeenCalled();
});

it("keeps submitted fields during saving and closes only on success", async () => {
  let finish!: (state: { ok: boolean; message?: string }) => void;
  mocks.save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(panel()); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Git-Einstellungen bearbeiten" }));
  await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  const submitted = mocks.save.mock.calls[0][2] as FormData;
  expect(Object.fromEntries(submitted)).toEqual(defaults);
  expect(new FormData(screen.getByLabelText("Branch").closest("form")!).get("repository")).toBe("owner/repo");
  await act(async () => finish({ ok: false, message: "Branch prüfen" }));
  expect(screen.getByRole("status").textContent).toBe("Branch prüfen");
  mocks.save.mockResolvedValueOnce({ ok: true });
  await user.click(screen.getByRole("button", { name: "Änderungen speichern" }));
  await screen.findByRole("button", { name: "Versionen prüfen" });
  expect(screen.queryByLabelText("Branch")).toBeNull();
});

it("does not repeat a persisted scan error or successful scan text", async () => {
  mocks.scan.mockResolvedValueOnce({ ok: false, message: "GitHub HTTP 404" }).mockResolvedValueOnce({ ok: true, message: "Git gelesen: next 16.4.5" });
  render(panel("watch", "GitHub HTTP 404")); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Versionen prüfen" }));
  await waitFor(() => expect(mocks.scan).toHaveBeenCalledOnce());
  expect(screen.queryByRole("status")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Versionen prüfen" }));
  await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Git gelesen: next 16.4.5")).toBeNull();
});

it("offers an explicit setup step before a repository has been configured", async () => {
  render(<RepositoryPanel applicationId="app" defaults={defaults} lastError={null} readOnly={false}>{null}</RepositoryPanel>);
  const user = userEvent.setup();
  expect(screen.queryByRole("button", { name: "Versionen prüfen" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Versionsüberwachung aktivieren" }));
  expect(screen.getByRole("button", { name: "Einrichtung speichern" })).toBeTruthy();
});
