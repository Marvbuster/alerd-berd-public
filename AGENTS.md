# Alerd Berd

Next.js App Router, React, Prisma 6, PostgreSQL, Tailwind and Vitest.
The UI is currently German-only. Keep interface copy concise and in German.

Use `npx tsc --noEmit`, `npx vitest run` and `node --check scripts/dependency-worker.mjs`.
Verify container changes with `docker build .`. Database changes require Prisma
migrations, never `db push`. Keep public `/api/health` as database-free liveness.
Read SECURITY.md before changing the dependency worker's isolation or approval gates.
Do not commit secrets. Version comes from package.json. Publishing requires human review.
