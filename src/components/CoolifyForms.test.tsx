// @vitest-environment jsdom
import React from "react";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "@/test/render";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/app/coolify/actions", () => ({ saveConnection: save, syncConnection: vi.fn(), linkMonitor: vi.fn(), deleteConnection: vi.fn() }));
import { ConnectionForm } from "./CoolifyForms";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("submits name, origin and a test token intact through the pending transition", async () => {
  let finish!: (result: { ok: boolean; message: string }) => void;
  save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<ConnectionForm disabled={false} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Example");
  await user.type(screen.getByLabelText("Coolify-URL"), "https://coolify.example.com");
  await user.type(screen.getByLabelText("API-Token (nur read)"), "123|test-token");
  await user.click(screen.getByRole("button", { name: "prüfen und verbinden" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const form = save.mock.calls[0][1] as FormData;
  expect(form.get("label")).toBe("Example");
  expect(form.get("baseUrl")).toBe("https://coolify.example.com");
  expect(form.get("token")).toBe("123|test-token");
  // Pending fields must remain successful form controls, not disappear from snapshots.
  const pendingForm = new FormData(screen.getByRole("button").closest("form")!);
  expect(pendingForm.get("label")).toBe("Example");
  expect(pendingForm.get("token")).toBe("123|test-token");
  await act(async () => finish({ ok: true, message: "verbunden" }));
  expect(screen.getByRole("status").textContent).toBe("verbunden");
});
