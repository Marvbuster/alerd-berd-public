// Teilschritte eines Worker-Schritts (DependencyJob.progress, geschrieben vom
// Worker über createProgress). Das Feld kommt als JSON aus der DB, deshalb hier
// defensiv lesen: alles, was nicht passt, fällt weg.

export type ProgressStep = { label: string; startedAt: string; endedAt: string | null; ok: boolean | null };

export function parseProgress(value: unknown): ProgressStep[] {
  const steps = (value as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const { label, startedAt, endedAt, ok } = s as Record<string, unknown>;
    if (typeof label !== "string" || typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return [];
    return [{ label: label.slice(0, 120), startedAt, endedAt: typeof endedAt === "string" ? endedAt : null, ok: typeof ok === "boolean" ? ok : null }];
  });
}

// Was gerade läuft: der jüngste offene Teilschritt. Laufen zwei parallel
// (Analyse: Claude und Build), zeigt das den zuletzt gestarteten.
export function currentStep(steps: ProgressStep[]): ProgressStep | null {
  return steps.findLast((s) => !s.endedAt) ?? null;
}
