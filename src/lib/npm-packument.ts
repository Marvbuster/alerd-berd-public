// npm-Packumente sind riesig (@prisma/client entpackt ~69 MB, next ~32 MB), weil
// sie jedes Manifest jeder Version enthalten. Alerd braucht davon nur `time` und
// `dist-tags`. res.json() hielt das ganze Dokument samt Objektbaum im Heap, und
// Node gab den Speicher danach kaum zurück (Board und Worker lagen dauerhaft bei
// mehreren hundert MB). Dieser Scanner liest den Strom zeichenweise, merkt sich
// nur die Tiefe und puffert ausschließlich die Werte der gesuchten Top-Level-Keys.

const WANTED = new Set(["time", "dist-tags"]);

export async function extractTopLevel(chunks: AsyncIterable<string>, wanted = WANTED): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  let depth = 0;
  let inString = false;
  let escaped = false;
  // Zuletzt gelesener String auf Tiefe 1 (Kandidat für einen Key) und ob danach ein ":" kam.
  let keyBuf: string | null = null;
  let lastKey: string | null = null;
  let expectValue = false;
  // Laufende Aufzeichnung eines gesuchten Werts.
  let capture: { key: string; buf: string[]; start: number } | null = null;

  for await (const chunk of chunks) {
    let from = 0;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') { inString = false; if (keyBuf !== null) { lastKey = keyBuf; keyBuf = null; } }
        else if (keyBuf !== null) keyBuf += ch;
        continue;
      }
      if (ch === '"') {
        inString = true;
        // Nur auf Tiefe 1 und außerhalb eines Werts sind Strings Keys.
        if (depth === 1 && !expectValue && !capture) keyBuf = "";
        continue;
      }
      if (ch === ":" && depth === 1 && !capture) {
        expectValue = true;
        if (lastKey !== null && wanted.has(lastKey)) { capture = { key: lastKey, buf: [], start: depth }; from = i + 1; }
        continue;
      }
      if (ch === "{" || ch === "[") { depth++; continue; }
      if (ch === "}" || ch === "]") {
        depth--;
        if (capture && depth === capture.start) {
          capture.buf.push(chunk.slice(from, i + 1));
          out[capture.key] = JSON.parse(capture.buf.join(""));
          capture = null; expectValue = false; lastKey = null;
          if (Object.keys(out).length === wanted.size) return out;
        }
        continue;
      }
      if (ch === "," && depth === 1) { expectValue = false; lastKey = null; }
    }
    if (capture) capture.buf.push(chunk.slice(from));
    from = 0;
  }
  return out;
}

export async function* decodeStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    // Sobald beide Werte da sind, bricht extractTopLevel ab: Rest nicht mehr laden.
    reader.cancel().catch(() => {});
  }
}
