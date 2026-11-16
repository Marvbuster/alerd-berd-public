# Alerd Berd

A self-hosted monitoring board for service availability, structured health checks,
incidents, Web Push and email alerts. Its health contract includes components,
metrics and runtime package versions. Dependency updates connect Coolify, GitHub
and Claude Code: request analysis, approve preparation, review the tested diff,
then separately approve commit and push. Coolify handles deployment.

Die Oberfläche ist derzeit nur auf Deutsch verfügbar. The interface is currently German-only.

## Requirements

Docker with Compose, PostgreSQL 17, and an HTTPS reverse proxy for remote access,
secure session cookies and Web Push. Local development uses Node.js 24 and npm.
Coolify, GitHub credentials and a Claude Code account are optional and needed
only for the corresponding integrations. Review [SECURITY.md](SECURITY.md) before
enabling the dependency worker. Use repositories you trust.

## Self-hosting

1. Copy `.env.example` to `.env` in the repository root.
2. Set `POSTGRES_PASSWORD` to a generated URL-safe password (for example
   `openssl rand -hex 24`), `AUTH_SECRET` (`openssl rand -base64 48`),
   `CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -hex 32`), `RUN_CHECKS_SECRET`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ALERD_PUBLIC_URL` (your external HTTPS URL).
   Keep the encryption key stable and back it up with the database.
3. Run `docker compose --env-file .env -f deploy/docker-compose.yml up -d --build`.
4. Route your HTTPS reverse proxy to `127.0.0.1:3000`. Sign in with the seeded
   admin account. The entrypoint applies migrations before starting each service.
5. Schedule authenticated `GET /api/run-checks` calls, for example every minute:
   `curl --fail -H "Authorization: Bearer $RUN_CHECKS_SECRET" "$ALERD_PUBLIC_URL/api/run-checks"`.
   The web process does not run checks on a timer by itself.

The worker is optional. Enable it with `--profile worker` in the Compose command.
It runs as root inside its container to assign separate job UIDs; do not override
its user. Its persistent workspace has a dedicated volume. Do not mount the Docker
socket or host working directories. Configure integration credentials in Settings.
Database and worker workspace volumes must be backed up. `down -v` deletes them.

Compose builds locally, so no registry or public repository name is required.
Release tags `v*` publish an image at `ghcr.io/<owner>/<repository>` via GitHub Actions.
The repository name is resolved automatically, including lowercase normalization.

## Environment

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Required by the self-hosting Compose database. Use URL-safe characters. |
| `DATABASE_URL` | PostgreSQL connection; Compose supplies its internal connection. |
| `AUTH_SECRET` | Session signature secret, at least 32 characters. Empty enables development access. Required for hosting. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Admin seed at container start; set a strong password. |
| `ALERD_PUBLIC_URL` | External base URL for mail links, invitations and host fallback. |
| `CREDENTIAL_ENCRYPTION_KEY` | Stable 64-character hex key for encrypted integration credentials. |
| `RUN_CHECKS_SECRET` | Bearer secret for the external check scheduler. |
| `COOLIFY_ALLOWED_ORIGINS` | Comma-separated permitted Coolify origins, without paths. |
| `GITHUB_TOKEN` | Optional server-side token for GitHub API rate limits; separate from per-user encrypted integration credentials. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys and contact URI; generate with `npx web-push generate-vapid-keys`. Supply them to both board and worker. |
| `BREVO_API_KEY`, `ALERT_FROM` | Preferred email transport and sender. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | SMTP fallback; without either transport email is logged only. |
| `SPEC_ACCESS_TOKEN` | Optional legacy global token for `/spec/*`; personal API keys or a session are preferred. |
| `SPEC_HEALTH_TOKEN` | Bearer token for this instance's `/api/spec-health`; empty returns 503. |
| `DEPENDENCY_WORKER` | `1` selects worker mode; only set on the worker. |
| `DEPENDENCY_WORKSPACE_ROOT` | Absolute persistent worker workspace path; set by Compose. |
| `PORT`, `HOSTNAME` | Container listener; defaults are `3000` and `0.0.0.0`. |
| `SOURCE_COMMIT` | Optional Docker build argument for reporting the running commit. |

The public health-contract links use `https://alerd.example.com`. Replace that
documentation placeholder with your instance URL when sharing instructions with
an app. `/api/health` is public liveness without database access; protected
`/api/spec-health` is the deeper check. Do not use the deep check for container liveness.

## Development

Start PostgreSQL, set `DATABASE_URL`, then run `npm ci`, `npx prisma generate`,
`npx prisma migrate deploy`, and `npm run dev`. Checks: `npx tsc --noEmit`,
`npx vitest run`, and `docker build .`. Use migrations for database changes.

## License

[Elastic License 2.0](LICENSE) (source-available). Read its terms before redistribution
or offering a hosted service.
