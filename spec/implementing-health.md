# Eine Alerd-Health-Route bauen

Damit Alerd Berd deinen Dienst überwachen kann, stellst du eine Health-Route
bereit, die beim Aufruf eine kleine JSON-Antwort liefert. Alerd pollt diese
Route regelmäßig und leitet daraus eine Ampel ab: grün (ok), orange (degraded),
rot (down). Deine Selbstmeldung kann die Ampel nur verschlechtern, nie
beschönigen.

Das ist alles, kein SDK, keine Registrierung im Code. Eine Route, ein JSON.

## Der Contract in einem Satz

Gib ein JSON-Objekt zurück, dessen einziges Pflichtfeld `status` ist
(`"ok"`, `"degraded"` oder `"down"`). Alles andere ist optional und verfeinert
nur das Bild.

- Schema (verbindlich, v1): https://alerd.example.com/spec/alerd-health.schema.json
- Vollständiges Beispiel: https://alerd.example.com/spec/example-health.json

### Minimal

Reicht völlig, um grün/rot zu melden:

```json
{ "status": "ok" }
```

### Mit Komponenten und Messwerten

Wenn du magst, meldest du Teil-Systeme und Zahlen mit Schwellen. Eine
`down`-Komponente färbt rot, eine `degraded`-Komponente orange. Bei den Metriken
gilt standardmäßig „höher ist schlechter": Wert ≥ `warn` → orange, ≥ `crit` → rot.
Für Werte, bei denen niedrig schlecht ist (freier Speicher, Guthaben), setzt du
`"direction": "below"`.

```json
{
  "status": "degraded",
  "version": "1.4.2",
  "uptimeSec": 852134,
  "timestamp": "2026-09-13T10:22:05Z",
  "components": [
    { "name": "database", "status": "ok" },
    { "name": "smtp-relay", "status": "degraded", "detail": "Queue-Backlog" }
  ],
  "metrics": [
    { "name": "response_time", "value": 180, "unit": "ms", "warn": 500, "crit": 2000 },
    { "name": "free_disk", "value": 42, "unit": "%", "warn": 15, "crit": 5, "direction": "below" }
  ]
}
```

### Live-Stand melden (optional, empfohlen)

Mit dem Feld `runtime` meldest du, was in deinem laufenden Prozess wirklich
steckt: die Node-Version, den Git-Commit, aus dem der Build stammt, und die
Versionen einzelner Pakete. Alerd Berd gleicht das täglich mit den
npm-Releases, der GitHub Advisory Database und dem Node-Release-Plan ab und
zeigt veraltete oder verwundbare Versionen als eigenes Badge, getrennt von der
Verfügbarkeits-Ampel. Bei einer critical Advisory kommt sofort ein Alarm.

```json
"runtime": {
  "node": "22.11.0",
  "commit": "2970d7f3b1c4e5a6d7f8091a2b3c4d5e6f708192",
  "packages": { "next": "16.4.5" }
}
```

- **`commit`** ist der wichtigste Wert. Stimmt er mit dem Commit im Repo überein,
  ist jede Paketversion aus dem Lockfile dieses Commits live belegt, und Alerd
  kann ein Update, das es selbst gepusht hat, exakt bestätigen. Ohne `commit`
  sieht Alerd nur die Pakete, die du unter `packages` meldest.
- **`node`** ist `process.versions.node`, ohne führendes `v`.
- **`packages`** sind exakte Versionen aus dem `node_modules` des laufenden
  Containers, nicht aus der `package.json` deines Repos. Typisch reicht `next`.

Wichtig ist, dass alle Werte zeigen, was **live** läuft. Ein Push, der nie
deployt wurde, soll hier auffallen. Felder, die du nicht kennst, lässt du weg.

#### Woher der Commit kommt

Auf **Coolify** heißt die Variable `SOURCE_COMMIT`. Sie ist beim Build
standardmäßig aus, damit der Docker-Cache greift. Pro App einschalten unter
**Advanced → Build → Source commit availability → Available during build**.
Im Dockerfile reichst du sie in der letzten Stage als `ARG` an `ENV` durch,
möglichst weit unten, dann wird pro Commit nur diese eine Schicht neu gebaut:

```dockerfile
# ganz am Ende der Runner-Stage
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
```

> **Wichtig, manueller Schritt:** Die Coolify-Einstellung kann kein Code und
> kein Coding-Agent setzen. Wer diese Route für jemanden baut, sagt ihm am Ende
> ausdrücklich: „In Coolify bei dieser App Advanced → Build → Source commit
> availability auf Available during build stellen, dann neu deployen.“ Ohne das
> bleibt `SOURCE_COMMIT` leer, und die App meldet keinen Commit. Prüfen: Nach dem
> Deploy enthält die Antwort `runtime.commit`.

In der Route liest du `process.env.SOURCE_COMMIT` und meldest es nur, wenn es
nach einem Commit aussieht (7 bis 40 Hex-Zeichen). Andere Plattformen haben
eigene Namen, etwa `VERCEL_GIT_COMMIT_SHA` oder `RENDER_GIT_COMMIT`. Nimm, was
deine Plattform liefert, oder schreib den Commit beim Build in eine Datei.

Das Feld `runtime` gehört nur in diese geschützte Route, nie in die öffentliche
Liveness, weil offene Versionsangaben Angreifern die Arbeit abnehmen.

## Zwei Health-Routes, nicht verwechseln

- **Liveness** (oft `/api/health`): flach, öffentlich, kein DB-Zugriff. Daran
  hängt meist schon dein Container-Healthcheck (Coolify, Kubernetes). Die lässt
  du in Ruhe.
- **Spec-Health** (diese hier, Konvention `/health`): eine zusätzliche, tiefere
  Route, die wirklich DB und Abhängigkeiten prüft und darum etwas kosten darf.
  Sie darf hinter einem Bearer-Token liegen. Adoption ist rein additiv, du legst
  sie neben die bestehende Liveness.

## Beispiel: Next.js (App Router)

`app/health/route.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

// Live-Version einmal pro Prozess lesen: aus dem node_modules des laufenden
// Containers (bei output: "standalone" liegt next im getraceten Bundle unter
// /app/node_modules/next). Fehlt sie, lässt du das Paket einfach weg.
let runtimeInfo: { node: string; commit?: string; packages: Record<string, string> } | undefined;
function getRuntime() {
  if (runtimeInfo) return runtimeInfo;
  const packages: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "node_modules/next/package.json"), "utf8"));
    if (typeof pkg.version === "string") packages.next = pkg.version;
  } catch {}
  // Commit des laufenden Builds (Coolify: SOURCE_COMMIT, siehe oben).
  const commit = process.env.SOURCE_COMMIT?.trim();
  return (runtimeInfo = { node: process.versions.node, ...(commit && /^[0-9a-f]{7,40}$/i.test(commit) ? { commit } : {}), packages });
}

export async function GET(req: Request) {
  // Optional: mit einem Bearer-Token schützen. Alerd sendet den Token mit,
  // den du beim Monitor hinterlegst.
  const token = process.env.HEALTH_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }

  // Echte Checks: DB-Ping, Abhängigkeiten, Zahlen sammeln.
  const dbOk = await pingDatabase().then(() => true).catch(() => false);

  return Response.json({
    status: dbOk ? "ok" : "down",
    version: process.env.APP_VERSION,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    runtime: getRuntime(),
    components: [{ name: "database", status: dbOk ? "ok" : "down" }],
  });
}
```

## Beispiel: Express / Node

```js
app.get("/health", async (req, res) => {
  const token = process.env.HEALTH_TOKEN;
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).send("unauthorized");
  }
  const dbOk = await pingDatabase().then(() => true).catch(() => false);
  res.json({
    status: dbOk ? "ok" : "down",
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    runtime: {
      node: process.versions.node,
      // Coolify: SOURCE_COMMIT, siehe „Woher der Commit kommt“.
      ...(/^[0-9a-f]{7,40}$/i.test(process.env.SOURCE_COMMIT ?? "") ? { commit: process.env.SOURCE_COMMIT } : {}),
    },
    components: [{ name: "database", status: dbOk ? "ok" : "down" }],
  });
});
```

## Danach

Gib dem Alerd-Betreiber (oder trag selbst ein, wenn du eine eigene Instanz
hast) nur noch zwei Dinge:

- die volle URL deiner Health-Route, z. B. `https://dein-dienst.de/health`
- falls geschützt: den Bearer-Token

Läuft die App auf Coolify und meldet `runtime.commit`, gehört noch ein Schritt
dazu, den nur ein Mensch erledigen kann: in Coolify bei der App **Advanced →
Build → Source commit availability → Available during build** einschalten und
neu deployen. Coding-Agents nennen diesen Schritt am Ende immer ausdrücklich.

Den Rest (Intervall, Schwellen-Fallbacks, Alarm per E-Mail/Push) stellt Alerd
ein. HTTP-Status ist egal, solange überhaupt eine parsebare Antwort kommt: über
die Ampel entscheidet dein `status` plus die Komponenten und Metriken. Kommt gar
keine Antwort (Timeout, DNS, Verbindung weg), ist das automatisch rot.
