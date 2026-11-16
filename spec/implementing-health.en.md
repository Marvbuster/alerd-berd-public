# Implementing an Alerd health route

Expose a small JSON health endpoint so Alerd Berd can monitor your service.
Alerd polls it and derives a status: green (`ok`), amber (`degraded`) or red
(`down`). Your reported status can make the result worse, never hide a failure.
No SDK or registration code is needed: one route, one JSON response.

## Contract

Only `status` is required: `"ok"`, `"degraded"` or `"down"`. All other fields
are optional.

- Authoritative v1 schema: https://alerd.example.com/spec/alerd-health.schema.json
- Complete example: https://alerd.example.com/spec/example-health.json
- German guide: https://alerd.example.com/spec/implementing-health.md

The schema and guides require a personal API key, session or instance spec token.
Send the token as `Authorization: Bearer <token>` when fetching them.

### Minimal response

```json
{ "status": "ok" }
```

### Components and metrics

Report subsystems and measurements when useful. A component reporting `down`
makes the monitor red; `degraded` makes it amber. By default higher metric values
are worse: value ≥ `warn` is amber, value ≥ `crit` is red. For metrics where low
values are bad, such as free disk space or credit, use `"direction": "below"`.

```json
{
  "status": "degraded",
  "version": "1.4.2",
  "uptimeSec": 852134,
  "timestamp": "2026-09-13T10:22:05Z",
  "components": [
    { "name": "database", "status": "ok" },
    { "name": "smtp-relay", "status": "degraded", "detail": "Queue backlog" }
  ],
  "metrics": [
    { "name": "response_time", "value": 180, "unit": "ms", "warn": 500, "crit": 2000 },
    { "name": "free_disk", "value": 42, "unit": "%", "warn": 15, "crit": 5, "direction": "below" }
  ]
}
```

### Report the running version (recommended)

`runtime` describes the process that is actually serving requests, including its
Node version, build commit and installed package versions. Alerd compares these
with npm releases, GitHub advisories and the Node release schedule. Package health
appears separately from availability. A critical advisory triggers an alert.

```json
{
  "runtime": {
    "node": "22.11.0",
    "commit": "2970d7f3b1c4e5a6d7f8091a2b3c4d5e6f708192",
    "packages": { "next": "16.4.5" }
  }
}
```

- `commit` is the most useful field. A matching Git commit proves the deployed
  versions of all packages in that commit's lockfile and lets Alerd confirm its
  own updates exactly. Without it, only explicitly reported packages are visible.
- `node` is `process.versions.node`, without a leading `v`.
- `packages` contains exact versions read from the running container's
  `node_modules`, not dependency ranges from your repository's `package.json`.

Omit unknown values. Report what is running, so a pushed but undeployed update
is visible. Put `runtime` in the protected spec route, never public liveness.

#### Build commit in Coolify

Coolify supplies `SOURCE_COMMIT` when enabled for an app under **Advanced → Build →
Source commit availability → Available during build**. Forward it in the final
Docker stage, near the bottom to preserve the earlier build cache:

```dockerfile
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT
```

Read `process.env.SOURCE_COMMIT` and include it only if it matches 7 to 40 hex
characters. Other platforms may supply `VERCEL_GIT_COMMIT_SHA`,
`RENDER_GIT_COMMIT`, or a commit file written at build time.

**Manual deployment step:** a coding agent implementing this route must tell the
operator to enable the Coolify setting above and redeploy. Code cannot enable
that setting. Without it, `SOURCE_COMMIT` is empty. After deployment, verify that
the spec-health response includes the deployed `runtime.commit`.

## Keep liveness and spec-health separate

- Public liveness (often `/api/health`) is shallow and does not query the database.
  Container health checks may already depend on it. Leave it unchanged.
- Spec-health (conventionally `/health`) is an additional, deeper route that checks
  real dependencies. It can do meaningful work and can require a bearer token.
  Adoption is additive: create it alongside the existing liveness route.

## Next.js App Router example

Create `app/health/route.ts`. Supply your own `pingDatabase()` implementation.

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

let runtimeInfo: { node: string; commit?: string; packages: Record<string, string> } | undefined;
function getRuntime() {
  if (runtimeInfo) return runtimeInfo;
  const packages: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "node_modules/next/package.json"), "utf8"));
    if (typeof pkg.version === "string") packages.next = pkg.version;
  } catch {}
  const commit = process.env.SOURCE_COMMIT?.trim();
  return (runtimeInfo = {
    node: process.versions.node,
    ...(commit && /^[0-9a-f]{7,40}$/i.test(commit) ? { commit } : {}),
    packages,
  });
}

export async function GET(req: Request) {
  const token = process.env.HEALTH_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return new Response("unauthorized", { status: 401 });
  }
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

Read package versions once per process. In a standalone Next.js image, the
traced package is under `/app/node_modules/next`. If a package is unavailable,
omit it. Alerd sends the bearer token configured on the monitor.

## Express / Node example

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
      ...(/^[0-9a-f]{7,40}$/i.test(process.env.SOURCE_COMMIT ?? "")
        ? { commit: process.env.SOURCE_COMMIT } : {}),
    },
    components: [{ name: "database", status: dbOk ? "ok" : "down" }],
  });
});
```

## Handoff

Give the Alerd operator the full health URL, such as
`https://service.example.com/health`, and its bearer token if protected. For
Coolify apps reporting `runtime.commit`, explicitly include the manual setting
and redeployment step above in the handoff.

Alerd configures the interval, fallback thresholds and email/push alert channels.
Once a response arrives and parses, its HTTP status does not determine the
monitor colour: `status`, components and metrics do. No response, including a
timeout, DNS failure or lost connection, is automatically red.
