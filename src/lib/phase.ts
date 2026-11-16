// Phasen-Versatz (0..1) im Check-Intervall, damit Checks gleichmäßig gestaffelt
// sind und möglichst nie gleichzeitig passieren. Ein neuer Monitor landet im
// Mittelpunkt der größten Lücke zwischen den bestehenden Phasen.
export function nextPhase(existing: number[]): number {
  const s = existing.map((p) => ((p % 1) + 1) % 1).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  if (s.length === 1) return (s[0] + 0.5) % 1;
  let bestGap = -1;
  let bestMid = 0;
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    const b = i + 1 < s.length ? s[i + 1] : s[0] + 1; // Wrap-around
    const gap = b - a;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = ((a + b) / 2) % 1;
    }
  }
  return ((bestMid % 1) + 1) % 1;
}
