import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { batchStage } from "./dependency-batch";

const j = (status: string, publishApprovalAt: Date | null = null) => ({ status, publishApprovalAt });
const open = {};

describe("batchStage", () => {
  it("wartet mit Freigabe 1, bis keine Analyse mehr läuft", () => {
    expect(batchStage(open, [j("READY_FOR_REVIEW"), j("ANALYZING")])).toBe("analyzing");
    expect(batchStage(open, [j("READY_FOR_REVIEW"), j("AWAITING_NODE")])).toBe("analyzing");
    expect(batchStage(open, [j("READY_FOR_REVIEW"), j("FAILED")])).toBe("approval1");
  });
  it("wartet mit Freigabe 2, bis alle Vorbereitungen durch sind", () => {
    expect(batchStage(open, [j("READY_TO_PUSH"), j("RUNNING")])).toBe("preparing");
    expect(batchStage(open, [j("READY_TO_PUSH"), j("READY_TO_PUSH")])).toBe("approval2");
  });
  it("pusht, sobald alle übrigen Pushes freigegeben sind", () => {
    const now = new Date();
    expect(batchStage(open, [j("READY_TO_PUSH", now), j("DEPLOYING")])).toBe("publishing");
    expect(batchStage(open, [j("READY_TO_PUSH", now), j("LIVE")])).toBe("publishing");
  });
  it("ist fertig, wenn kein Job mehr offen ist, auch nach einer Pause", () => {
    expect(batchStage(open, [j("LIVE"), j("DEPLOY_FAILED"), j("CANCELLED")])).toBe("done");
    expect(batchStage({ pausedAt: new Date() }, [j("LIVE")])).toBe("done");
    expect(batchStage({ pausedAt: new Date() }, [j("READY_TO_PUSH", new Date())])).toBe("paused");
  });
  it("Abbruch schlägt alles", () => {
    expect(batchStage({ cancelledAt: new Date() }, [j("ANALYZING")])).toBe("cancelled");
  });
});

describe("recommendationLine", () => {
  it("nimmt den Empfehlungsabschnitt ohne Überschrift und Markdown", async () => {
    const { recommendationLine } = await import("./dependency-batch");
    const text = "## Risiko\n**sicher**\n\n## Begründung\nNur Fixes.\n\n## Empfehlung\n- **Vorbereiten.** Reine Patch-Releases.";
    expect(recommendationLine(text)).toBe("Vorbereiten. Reine Patch-Releases.");
    expect(recommendationLine("kein Aufbau")).toBeNull();
  });
});
