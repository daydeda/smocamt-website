# syntax=docker/dockerfile:1
# BuildKit is required for the RUN --mount=type=cache lines below. Docker 23+ and
# docker/build-push-action use it by default.

# Base image
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Full dependency tree (dev deps included): only `next build` needs it.
# Layer depends on the lockfile alone, so it stays cached across source edits.
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Production-only dependency tree. This is the node_modules the image ships.
# Runs in parallel with `builder` because BuildKit only waits on the stages a
# later stage actually copies from.
FROM base AS prod-deps
COPY package.json package-lock.json ./
# The lockfile has no `libc` field for these native packages, so npm also installs
# the glibc builds on Alpine (~105 MB, never loaded). Keep only musl. The wasm32
# sharp build is a fallback that is not used when a native build loads.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev \
  && rm -rf node_modules/@next/swc-linux-*-gnu \
            node_modules/@img/sharp-linux-* \
            node_modules/@img/sharp-libvips-linux-* \
            node_modules/@img/sharp-wasm32

# Rebuild the source code only when needed
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are inlined into the client bundle at BUILD time, not read
# from the container at runtime — setting this only in docker-stack.yml's
# `environment:` (a runtime mechanism) would silently do nothing. Must be
# supplied as a --build-arg (see .github/workflows/docker-publish.yml). Songsue's
# dashboard URL, e.g. https://songsue.vercel.app/dashboard — drives the
# check-in redirect countdown in src/components/NotificationModal.tsx; unset =
# that feature quietly stays disabled (falls back to the plain success message).
ARG NEXT_PUBLIC_SONGSUE_DASHBOARD_URL
ENV NEXT_PUBLIC_SONGSUE_DASHBOARD_URL=$NEXT_PUBLIC_SONGSUE_DASHBOARD_URL

# Same build-time-only constraint as above. This is the VAPID PUBLIC key (see
# src/modules/notifications/push.service.ts) — meant to reach the browser, not
# a secret; the matching VAPID_PRIVATE_KEY stays a runtime-only env var in
# docker-stack.yml, never here. Unset = GET /api/notifications/push/vapid-key
# 503s and the profile toggle surfaces a generic error on tap — push sends
# server-side no-op the same way (PushService checks all three VAPID vars).
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Build, then drop the build cache (Turbopack, ~180 MB, never read at runtime).
# Keep an empty .next/cache: the fetch cache writes into it (see the runner stage).
RUN npm run build && rm -rf .next/cache && mkdir -p .next/cache

# Production image: only what `npm run start` and the maintenance scripts need.
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# pg_dump for the scheduled backup service (scripts/backup-db.mjs, see the `backup`
# service in docker-stack.yml). Falls back to the generic package name if
# postgresql16-client isn't in this Alpine release's repos.
RUN apk add --no-cache postgresql16-client || apk add --no-cache postgresql-client

# tsx runs the maintenance scripts from the Portainer web console (`npm run
# db:migrate:container` and the other *:container variants). It was a devDependency,
# so it is installed globally here at the lockfile's pinned version to keep it out of
# the production node_modules. Bump this when the tsx version in package-lock.json changes.
RUN --mount=type=cache,target=/root/.npm npm install -g tsx@4.21.0

# Set the correct permission for prerender cache and uploads.
# .uploads-private holds PDPA form docs + payment slips when running without
# Supabase Storage; it must exist and be writable by the nextjs user, and is
# bind-mounted to the host in docker-compose.yml so the data persists.
WORKDIR /app
RUN mkdir -p public/uploads .uploads-private && chown -R nextjs:nodejs public/uploads .uploads-private

# Production dependencies (root-owned, read-only to the app user, as before).
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built code and configuration
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# next build writes to .next by default; the .next.nosync distDir in
# next.config.ts only kicks in on the iCloud-synced local path, never in CI / the
# container (path has no "CloudDocs"/"Mobile Documents"), so copy .next.
# --chown: this COPY runs before `USER nextjs` below, so without it the whole
# tree lands owned by root — and the app then can't write to
# .next/cache/fetch-cache at runtime (EACCES), which silently disables Next's
# fetch/data cache writes (fetch-cache misses/never-revalidates) and floods the
# logs with "Failed to update prerender cache" on every request.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next

# Source + maintenance scripts needed to run migrations/seed/elevate/file-import
# from the Portainer web console (there is no host shell on the swarm). These read
# DATABASE_URL straight from the container env — no .env file required. tsconfig.json
# is needed because tsx resolves the `@/` path alias used by src/.
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
