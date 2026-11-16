import { describe, expect, it } from "vitest";
import { alreadyDelivered, jobLabel, jobPackages, updateCandidate, updateMaturity } from "./dependency-target";

describe("alreadyDelivered", () => {
  it("erkennt einen schon gepushten oder live bestätigten Bump", () => {
    expect(alreadyDelivered("16.4.6", { jobs: [{ status: "LIVE", targetVersion: "16.4.6" }] })).toBe(true);
    expect(alreadyDelivered("16.4.6", { jobs: [{ status: "DEPLOYING", targetVersion: "16.4.6" }] })).toBe(true);
    expect(alreadyDelivered("16.4.6", { jobs: [{ status: "PUSHED", targetVersion: "16.4.7" }] })).toBe(true);
  });

  it("zählt fehlgeschlagene oder abgebrochene Jobs nicht", () => {
    expect(alreadyDelivered("16.4.6", { jobs: [{ status: "FAILED", targetVersion: "16.4.6" }, { status: "CANCELLED", targetVersion: "16.4.6" }, { status: "DEPLOY_FAILED", targetVersion: "16.4.6" }] })).toBe(false);
  });

  it("nimmt die live gemeldete Version, wenn der Git-Stand hinterherhinkt", () => {
    expect(alreadyDelivered("16.4.6", { runtimeVersions: ["16.4.6"] })).toBe(true);
    expect(alreadyDelivered("16.4.6", { runtimeVersions: ["16.4.5", null] })).toBe(false);
    expect(alreadyDelivered("16.4.6", {})).toBe(false);
  });
});

describe("Pakete im Job und Kandidaten", () => {
  it("liest gebündelte und alte Jobs", () => {
    expect(jobPackages({ packageName: "next", targetVersion: "16.4.6" })).toEqual([{ name: "next", version: "16.4.6", from: null }]);
    expect(jobLabel(jobPackages({ targetVersion: "6.2.4", packages: [{ name: "jose", version: "6.2.4", from: "6.2.3" }, { name: "next", version: "16.4.6" }] }))).toBe("jose 6.2.4, Next 16.4.6");
  });
  it("erkennt next auch in gebündelten Jobs als geliefert", () => {
    const jobs = [{ status: "LIVE", targetVersion: "6.2.4", packages: [{ name: "jose", version: "6.2.4" }, { name: "next", version: "16.4.6" }] }];
    expect(alreadyDelivered("16.4.6", { jobs })).toBe(true);
    expect(alreadyDelivered("6.2.4", { jobs, name: "jose" })).toBe(true);
  });
  const now = new Date("2026-11-12T12:00:00Z");
  const versions = Object.fromEntries(["0.34.5", "0.35.4", "0.35.5", "0.35.6", "4.4.3", "4.4.4", "4.6.6", "4.6.7"].map((version) => [version, "2026-11-01T12:00:00Z"]));
  it("nimmt ab 1.0 die neueste Minor, bei 0.x nur den Patch, und markiert Breaking bei 0.x-Minor", () => {
    expect(updateCandidate("sharp", "0.34.5", versions, ["0.35.5", "0.35.4"], now)).toEqual({ name: "sharp", from: "0.34.5", to: "0.35.6", jump: "minor", breaking: true, security: true, critical: false });
    expect(updateCandidate("zod", "4.4.3", versions, ["4.6.6"], now)).toEqual({ name: "zod", from: "4.4.3", to: "4.6.7", jump: "minor", breaking: false, security: true, critical: false });
    expect(updateCandidate("zod", "4.4.3", versions, [], now)).toEqual({ name: "zod", from: "4.4.3", to: "4.6.7", jump: "minor", breaking: false, security: false, critical: false });
    expect(updateCandidate("zod", "4.6.6", versions, [], now)).toMatchObject({ to: "4.6.7", jump: "patch" });
    expect(updateCandidate("sharp", "0.34.5", versions, [], now)).toBeNull();
    expect(updateCandidate("sharp", "0.35.4", versions, [], now)).toMatchObject({ to: "0.35.6", jump: "patch", breaking: false });
    expect(updateCandidate("zod", "4.6.7", versions, [], now)).toBeNull();
  });

  it("sperrt frische reguläre Releases 24 Stunden und erlaubt nur den exakten kritischen Fix sofort", () => {
    const fresh = { "1.0.0": "2026-11-01T12:00:00Z", "1.0.1": "2026-11-11T13:00:00Z", "1.0.2": "2026-11-11T14:00:00Z" };
    expect(updateMaturity(fresh, "1.0.1", now).ready).toBe(false);
    expect(updateCandidate("pkg", "1.0.0", fresh, [], now)).toBeNull();
    expect(updateCandidate("pkg", "1.0.0", fresh, [{ version: "1.0.1", critical: true }], now)).toMatchObject({ to: "1.0.1", critical: true, security: true });
  });
});

describe("Minor-Empfehlung bei Paketfamilien", () => {
  it("geht bei framer-motion direkt auf die neueste 12er, passend zu motion-dom", () => {
    const now = new Date("2026-11-14T12:00:00Z"), old = "2026-01-01T00:00:00Z";
    const versions = { "12.7.4": old, "12.7.5": old, "12.42.2": old, "12.43.0": old, "12.43.1": "2026-11-14T06:00:00Z", "14.14.0": old };
    expect(updateCandidate("framer-motion", "12.7.4", versions, [], now)).toMatchObject({ to: "12.43.0", jump: "minor", breaking: false });
  });
});
