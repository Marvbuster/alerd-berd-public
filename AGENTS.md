# Alerd Berd

Next.js App Router, React, Prisma 6, PostgreSQL, Tailwind and Vitest.
The UI supports German and English without URL prefixes. German is the master
catalog in messages/de.json; maintain parity with messages/en.json. Preserve
German wording and write concise, natural English. Use the active request locale
for the UI and the recipient's User.locale for background messages. Read the
shared scripts/i18n.mjs formatter before changing worker or mail messages.

Use `npx tsc --noEmit`, `npx vitest run` and `node --check scripts/dependency-worker.mjs`.
Verify container changes with `docker build .`. Database changes require Prisma
migrations, never `db push`. Keep public `/api/health` as database-free liveness.
Read SECURITY.md before changing the dependency worker's isolation or approval gates.
Do not commit secrets. Version comes from package.json. Publishing requires human review.
