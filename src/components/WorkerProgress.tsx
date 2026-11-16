import type { ProgressStep } from "@/lib/dependency-progress";
import { elapsed } from "@/lib/dependency-phase";

// Checkliste der Teilschritte mit Dauer. Läuft ein Schritt noch, zählt die Uhr mit.
export function WorkerProgress({ steps, now, compact = false }: { steps: ProgressStep[]; now: Date; compact?: boolean }) {
  if (!steps.length) return null;
  return <ol className={`worker-progress${compact ? " worker-progress--compact" : ""}`} aria-label="Teilschritte">{steps.map((step, i) => {
    const state = !step.endedAt ? "running" : step.ok === false ? "failed" : "done";
    const end = step.endedAt ? new Date(step.endedAt) : now;
    return <li key={`${step.startedAt}-${i}`} className={`worker-progress-step worker-progress-step--${state}`}>
      <span className="worker-progress-mark" aria-hidden="true">{state === "done" ? "✓" : state === "failed" ? "!" : ""}</span>
      <span className="worker-progress-label">{step.label}</span>
      <span className="worker-progress-time">{elapsed(new Date(step.startedAt), end)}</span>
    </li>;
  })}</ol>;
}
