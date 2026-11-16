#!/bin/sh
# Führt ausstehende Migrations aus, dann Start des Next.js-Standalone-Servers.
set -e

echo "==> prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy

echo "==> seed admin + backfill owner"
# Idempotent; darf den Start nicht blockieren (nächster Deploy versucht es erneut).
node scripts/seed-admin.mjs || echo "[seed-admin] WARN: Seed fehlgeschlagen, fahre fort"

echo "==> starting server"
if [ "${DEPENDENCY_WORKER:-}" = "1" ]; then
  echo "==> starting dependency worker"
  exec node scripts/dependency-worker.mjs
fi
exec node server.js
