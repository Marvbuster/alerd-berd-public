import { describe, expect, it } from "vitest";
import { analysisRecommendation, retryStep, dependencyPhase, dependencySteps, elapsed, isUnread, WORKER_PICKUP_MS } from "./dependency-phase";

const now = new Date("2026-11-11T18:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const job = (status: string, extra: Partial<Parameters<typeof dependencyPhase>[0]> = {}) =>
  ({ status, updatedAt: ago(5_000), workerLockedUntil: null, workerAttemptAt: null, lastError: null, ...extra });

describe("dependencyPhase", () => {
  it("nennt bei grüner Ausgangslage nur noch den Build mit dem Update", () => {
    const locked = { workerLockedUntil: new Date(now.getTime() + 60_000) };
    expect(dependencyPhase(job("RUNNING", locked), now).detail).toMatch(/^Einmal ohne und einmal mit/);
    const done = dependencyPhase(job("RUNNING", { ...locked, messages: [{ role: "SYSTEM", content: "Ausgangslage grün: ci, build ohne Update in der Sandbox bestanden.", createdAt: now }] }), now);
    expect(done.title).toBe("Build und Tests laufen");
    expect(done.detail).toMatch(/^Mit dem Update, ohne Update war der Stand schon in der Analyse grün/);
  });

  it("sagt klar, wann der Nutzer dran ist", () => {
    expect(dependencyPhase(job("AWAITING_CLAUDE"), now).actor).toBe("user");
    expect(dependencyPhase(job("READY_FOR_REVIEW"), now).actor).toBe("user");
    expect(dependencyPhase(job("READY_TO_PUSH"), now).detail).toMatch(/Commit & Push/);
    expect(dependencyPhase(job("READY_TO_PUSH"), now, { hasPublish: false }).title).toMatch(/Schreibzugang/);
  });

  it("zeigt die laufende Arbeit mit Startzeit, sobald der Worker den Job hält", () => {
    const started = ago(90_000);
    const phase = dependencyPhase(job("ANALYZING", { workerLockedUntil: new Date(now.getTime() + 60_000), workerAttemptAt: started }), now);
    expect(phase).toMatchObject({ actor: "worker", title: "Claude analysiert", since: started });
  });

  it("unterscheidet kurzes Warten von einem fehlenden Worker", () => {
    expect(dependencyPhase(job("ANALYZING"), now).actor).toBe("waiting");
    expect(dependencyPhase(job("ANALYZING", { updatedAt: ago(WORKER_PICKUP_MS + 1_000) }), now).actor).toBe("stalled");
    // Abgelaufene Lease zählt nicht als übernommen.
    expect(dependencyPhase(job("APPROVED", { updatedAt: ago(120_000), workerLockedUntil: ago(1_000) }), now).actor).toBe("stalled");
  });

  it("begleitet den Deploy bis zum Fazit", () => {
    const lock = { workerLockedUntil: new Date(now.getTime() + 20_000), workerAttemptAt: ago(60_000) };
    expect(dependencyPhase(job("DEPLOYING", lock), now)).toMatchObject({ actor: "worker", title: "Warte auf den Deploy" });
    expect(dependencyPhase(job("LIVE"), now)).toMatchObject({ actor: "done", title: "Live bestätigt" });
    expect(dependencyPhase(job("DEPLOY_FAILED", { lastError: "meldet weiter 16.4.5" }), now)).toMatchObject({ actor: "failed", detail: "meldet weiter 16.4.5" });
  });

  it("meldet Ende und Fehler mit Grund", () => {
    expect(dependencyPhase(job("PUSHED"), now).actor).toBe("done");
    expect(dependencyPhase(job("FAILED", { lastError: "Build rot" }), now)).toMatchObject({ actor: "failed", detail: "Build rot" });
  });

  it("formatiert die Laufzeit als m:ss", () => {
    expect(elapsed(ago(125_000), now)).toBe("2:05");
    expect(elapsed(new Date(now.getTime() + 5_000), now)).toBe("0:00");
  });
});

describe("dependencySteps", () => {
  it("führt durch Analyse, Vorbereitung und Push", () => {
    expect(dependencySteps("ANALYZING")).toEqual(["running", "todo", "todo", "todo"]);
    expect(dependencySteps("READY_FOR_REVIEW")).toEqual(["done", "current", "todo", "todo"]);
    expect(dependencySteps("RUNNING")).toEqual(["done", "running", "todo", "todo"]);
    expect(dependencySteps("READY_TO_PUSH")).toEqual(["done", "done", "current", "todo"]);
    expect(dependencySteps("DEPLOYING")).toEqual(["done", "done", "done", "running"]);
    expect(dependencySteps("LIVE")).toEqual(["done", "done", "done", "done"]);
    expect(dependencySteps("DEPLOY_FAILED")).toEqual(["done", "done", "done", "failed"]);
  });

  it("markiert den abgebrochenen Schritt", () => {
    expect(dependencySteps("FAILED")).toEqual(["failed", "todo", "todo", "todo"]);
    expect(dependencySteps("FAILED", { analysed: true })).toEqual(["done", "failed", "todo", "todo"]);
    expect(dependencySteps("FAILED", { analysed: true, validated: true })).toEqual(["done", "done", "failed", "todo"]);
  });
});

describe("isUnread", () => {
  it("zählt nur Zustände, in denen der Nutzer etwas tun oder sehen soll", () => {
    const review = job("READY_FOR_REVIEW");
    expect(isUnread(dependencyPhase(review, now), { ...review, seenAt: null })).toBe(true);
    expect(isUnread(dependencyPhase(review, now), { ...review, seenAt: now })).toBe(false);
    const running = job("ANALYZING", { workerLockedUntil: new Date(now.getTime() + 60_000) });
    expect(isUnread(dependencyPhase(running, now), { ...running, seenAt: null })).toBe(false);
  });

  it("wird wieder ungelesen, wenn danach ein neuer Schritt fertig wird", () => {
    const failed = job("FAILED", { updatedAt: now });
    expect(isUnread(dependencyPhase(failed, now), { ...failed, seenAt: ago(60_000) })).toBe(true);
  });
});

describe("analysisRecommendation", () => {
  const analysis = "## Risiko: sicher\n\nNur Bugfixes.\n\n## Quellen\n\n- https://github.com/vercel/next.js/releases\n\n## Empfehlung\n\nUpdate vorbereiten.\n\n## Unsicherheiten\n\nKeine.";
  it("liefert bei sicherem Risiko den Abschnitt Empfehlung", () => {
    expect(analysisRecommendation(analysis)).toEqual({ safe: true, recommendation: "## Empfehlung\n\nUpdate vorbereiten." });
  });
  it("erkennt fette Zeilen als Abschnitt", () => {
    const text = "**Risiko:** sicher\n\nBegründung …\n\n**Empfehlung:** Update vorbereiten, danach Login testen.";
    expect(analysisRecommendation(text).recommendation).toBe("**Empfehlung:** Update vorbereiten, danach Login testen.");
  });
  it("nimmt ohne Empfehlung den letzten Abschnitt", () => {
    expect(analysisRecommendation("## Risiko: sicher\n\nok\n\n## Fazit\n\nPasst.").recommendation).toBe("## Fazit\n\nPasst.");
  });
  it("klappt ohne Gliederung nichts ein und meldet riskante Analysen", () => {
    expect(analysisRecommendation("Alles gut.")).toEqual({ safe: false, recommendation: null });
    expect(analysisRecommendation("## Risiko: riskant\n\nx\n\n## Empfehlung\n\nNicht updaten.").safe).toBe(false);
  });
});

describe("retryStep", () => {
  const at = new Date("2026-11-12T08:00:00Z");
  it("wiederholt genau den gescheiterten Schritt", () => {
    expect(retryStep({ status: "FAILED" })?.status).toBe("ANALYZING");
    expect(retryStep({ status: "FAILED", approvalAt: at })?.status).toBe("APPROVED");
    expect(retryStep({ status: "FAILED", approvalAt: at, diffHash: "x", publishApprovalAt: at })?.status).toBe("PUBLISHING");
    expect(retryStep({ status: "DEPLOY_FAILED", approvalAt: at, diffHash: "x", publishApprovalAt: at, publishedAt: at })?.status).toBe("DEPLOYING");
  });
  it("bietet nichts an, solange der Job läuft oder abgebrochen ist", () => {
    expect(retryStep({ status: "RUNNING" })).toBeNull();
    expect(retryStep({ status: "CANCELLED" })).toBeNull();
  });
});

describe("Deploy gefunden", () => {
  it("meldet die gefundene Version statt weiter auf den Deploy zu warten", () => {
    const seenAt = ago(30_000);
    const job = { status: "DEPLOYING", updatedAt: ago(300_000), workerLockedUntil: new Date(now.getTime() + 20_000), workerAttemptAt: ago(10_000), lastError: null,
      messages: [{ role: "SYSTEM", content: "Neue Version gefunden: Next 16.4.6 läuft.", createdAt: seenAt }] };
    const phase = dependencyPhase(job, now);
    expect(phase.title).toBe("Neue Version gefunden");
    expect(phase.since).toEqual(seenAt);
  });
});

describe("Worker-Schlange", () => {
  const waiting = { id: "j2", status: "ANALYZING", updatedAt: ago(5 * 60_000), workerLockedUntil: null, workerAttemptAt: null, lastError: null };
  it("zeigt den laufenden Job statt eines Ausfalls", () => {
    const busy = { jobId: "j1", appName: "Example App", owner: "user-b", label: "Next 16.4.6", status: "RUNNING", since: ago(3 * 60_000) };
    const phase = dependencyPhase(waiting, now, { workerBusy: busy });
    expect(phase.title).toBe("Wartet in der Schlange");
    expect(phase.detail).toContain("Example App von user-b: Next 16.4.6, Build und Tests seit");
  });
  it("nennt ohne laufenden Job, wann der Worker zuletzt aktiv war", () => {
    const phase = dependencyPhase(waiting, now, { workerLastSeen: ago(12 * 60_000) });
    expect(phase.actor).toBe("stalled");
    expect(phase.detail).toContain("vor 12");
  });
});

describe("lokale Node in der Schrittleiste", () => {
  it("zeigt Warten auf die Node als laufenden Schritt, nicht als Fehler", () => {
    expect(dependencySteps("AWAITING_NODE")[0]).toBe("running");
    expect(dependencySteps("AWAITING_NODE", { analysed: true, validated: true })[3]).toBe("running");
  });
});
