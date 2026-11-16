// @vitest-environment jsdom
import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { render } from "@/test/render";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryComparison, type RepositoryComparisonProps } from "./RepositoryComparison";

const now = new Date("2026-11-11T12:00:00Z");
const props = (): RepositoryComparisonProps => ({
  snapshot: { commitSha: "a".repeat(40), declaredVersion: "^16.4.5", lockedVersion: "16.4.5", scannedAt: now }, lastError: null,
  monitors: [{ id: "m", name: "Monitor", enabled: true, intervalSec: 60, runtime: { version: "16.4.5", reportedAt: now } }],
  registry: { distTags: { latest: "17.0.0" }, versions: { "16.4.5": now.toISOString(), "16.4.6": now.toISOString(), "17.0.0": now.toISOString() } },
  registryMeta: { npmFetchedAt: now, lastError: null },
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows matching Git/runtime independently from a newer patch, keeping the minor line", () => {
  vi.useFakeTimers(); vi.setSystemTime(now); render(<RepositoryComparison {...props()} />);
  expect(screen.getByText(/Git und Runtime stimmen überein/)).toBeTruthy();
  expect(screen.getByText("Patch verfügbar: 16.4.6")).toBeTruthy();
  expect(screen.queryByText(/17\.0\.0/)).toBeNull();
});
it("still shows the patch when Git is updated but runtime is behind", () => {
  vi.useFakeTimers(); vi.setSystemTime(now); const p = props(); p.snapshot!.lockedVersion = "16.4.6";
  render(<RepositoryComparison {...p} />);
  expect(screen.getByText("Abweichung zwischen Git und Runtime")).toBeTruthy();
  expect(screen.getByText("Patch verfügbar: 16.4.6")).toBeTruthy();
});
it("labels stale reference data and does not imply a current check", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now.getTime() + 25 * 60 * 60_000)); render(<RepositoryComparison {...props()} />);
  expect(screen.getByText("Patch bekannt: 16.4.6")).toBeTruthy();
  expect(screen.getByText(/Referenzdaten fehlen oder sind veraltet/)).toBeTruthy();
  expect(screen.queryByText(/stimmen überein/)).toBeNull();
});
it("handles missing registry data and invalid runtime versions without claiming a match", () => {
  const p = props(); p.snapshot = null; p.registry = null; p.registryMeta.npmFetchedAt = null; p.monitors[0].runtime!.version = "unknown";
  render(<RepositoryComparison {...p} />);
  expect(screen.getByText("Noch keine Version für den Patchvergleich bekannt.")).toBeTruthy();
  expect(screen.getByText("Abgleich nicht verifiziert")).toBeTruthy();
});
