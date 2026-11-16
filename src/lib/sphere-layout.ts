// Platziert N Karten auf einer Sphärenkappe um +Z (zur Kamera). Die Kappe wächst
// mit N — solange die Sphere nicht voll ist, bleibt die Rotation auf die Kappe
// beschränkt, damit man den leeren Teil nie sieht.

export type Dir = [number, number, number];

export function capHalfAngle(n: number): number {
  // wenige Karten → enge Kappe; wächst, gedeckelt bei ~1.15 rad (~66°)
  return Math.min(0.38 + 0.11 * Math.max(n - 1, 0), 1.15);
}

export function placeOnCap(n: number): { dirs: Dir[]; half: number } {
  const half = capHalfAngle(n);
  if (n <= 1) return { dirs: [[0, 0, 1]], half };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const dirs: Dir[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const polar = half * Math.sqrt(t); // Winkel von +Z, dichter zur Mitte
    const az = i * golden;
    const sp = Math.sin(polar);
    dirs.push([sp * Math.cos(az), sp * Math.sin(az), Math.cos(polar)]);
  }
  return { dirs, half };
}
