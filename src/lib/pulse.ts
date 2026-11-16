// Kontinuierliche Puls-/EKG-Wellenform für die animierte Linie auf der Card.
// Reine Funktion von (status, zeit) → scrollt zeitlich kohärent.
import type { VizStatus } from "@/lib/viz";

function g(x: number) {
  return Math.exp(-x * x);
}

export function pulse(status: VizStatus, t: number): number {
  if (status === "DOWN") return 0.02 * Math.sin(t * 8.0); // fast flach
  if (status === "UNKNOWN") return 0.08 * Math.sin(t * 1.6) + 0.05 * Math.sin(t * 3.7 + 1.0);
  const degraded = status === "DEGRADED";
  const period = degraded ? 0.62 : 0.95;
  const ph = (t / period) % 1;
  const beat =
    0.06 * g((ph - 0.16) / 0.03) -
    0.07 * g((ph - 0.37) / 0.012) +
    0.95 * g((ph - 0.42) / 0.012) -
    0.2 * g((ph - 0.47) / 0.016) +
    0.18 * g((ph - 0.66) / 0.045);
  const noise = degraded ? 0.07 * Math.sin(t * 33.0) + 0.04 * Math.sin(t * 91.0) : 0;
  return beat * (degraded ? 0.85 : 1) + noise;
}
