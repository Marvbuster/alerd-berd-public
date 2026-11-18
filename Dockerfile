# --- Builder: installiert devDeps (Build-Tools) und baut den Standalone-Output ---
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
# devDeps explizit installieren (typescript/tailwind/prisma-CLI) — unabhängig vom
# NODE_ENV, damit der Build trotzdem in PRODUCTION laufen kann. .npmrc
# (legacy-peer-deps) muss vorher da sein, sonst crasht npm am Vitest-Peer-Set.
RUN npm ci --include=dev

COPY . .

# WICHTIG: in Production bauen. Sonst baut Next im Dev-Mode und der Prerender von
# /_global-error bricht (useContext null).
ENV NODE_ENV=production
# prisma generate braucht eine URL zur Build-Zeit — Dummy, Runtime überschreibt sie
ENV DATABASE_URL="postgres://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
RUN npm run build

# --- Laufzeit-Abhängigkeiten außerhalb von Next ---
# Next selbst kommt getract und schlank aus .next/standalone. Zusätzlich brauchen der
# Worker (@prisma/client, web-push, semver, bcryptjs, auch seed-admin) und migrate deploy
# (prisma-CLI samt @prisma/config → effect …) ihre Pakete. Gezielt in der Version
# aus dem Lockfile. Früher kam das komplette node_modules des Builders samt devDeps ins
# Image, bei zwei Coolify-Ressourcen (Board, Worker) doppelt.
FROM node:24-alpine AS runtime-deps
WORKDIR /app
COPY package-lock.json ./
RUN node -e "const l = require('./package-lock.json').packages; \
const pick = ['prisma', '@prisma/client', 'web-push', 'semver', 'bcryptjs', 'intl-messageformat', 'yaml']; \
const dependencies = Object.fromEntries(pick.map((n) => [n, l['node_modules/' + n].version])); \
require('fs').writeFileSync('package.json', JSON.stringify({ name: 'alerd-runtime', private: true, dependencies }));" \
 && npm install --omit=dev --no-package-lock --no-audit --no-fund && npm cache clean --force

# --- Runner: Prod-Image ---
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DISABLE_AUTOUPDATER=1

# Der getrennte Dependency-Worker braucht Git und die Claude-Code-CLI. Er wird
# in Coolify als zweite Ressource mit DEPENDENCY_WORKER=1 betrieben.
RUN apk add --no-cache git openssh-client && npm install --global @anthropic-ai/claude-code@2.1.322

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# Health-Contract-Quellen für die token-geschützte /spec/-Route (liest spec/ zur
# Laufzeit aus process.cwd()). Explizit kopieren, unabhängig vom File-Tracing.
COPY --from=builder /app/spec ./spec
# Seed-Skript (Admin-Anlage + Owner-Backfill), vom Entrypoint nach migrate deploy.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/messages ./messages
# Die Laufzeit-Pakete ins standalone-node_modules legen, dazu der im Builder
# generierte Prisma-Client. Ein Cherry-Pick von prisma/@prisma aus dem Builder reichte
# nicht, die CLI braucht ihre transitiven Deps.
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
# start-period großzügig: migrate deploy darf beim Start dauern (Coolify-Restart-Loop vermeiden)
# 127.0.0.1 statt localhost: der Standalone-Server lauscht auf IPv4 (0.0.0.0);
# localhost geht im Container auf IPv6 ::1 → "Connection refused".
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Commit des Builds für runtime.commit der Spec-Health. Coolify reicht ihn nur
# durch, wenn „Source commit availability“ auf „Available during build“ steht.
# Als letzte Schicht, damit der wechselnde Wert keinen Cache davor bricht.
ARG SOURCE_COMMIT=""
ENV SOURCE_COMMIT=$SOURCE_COMMIT

ENTRYPOINT ["./docker-entrypoint.sh"]
