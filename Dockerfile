# Base image
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* vars are inlined into the client bundle at BUILD time, not read
# from the container at runtime — setting this only in docker-stack.yml's
# `environment:` (a runtime mechanism) would silently do nothing. Must be
# supplied as a --build-arg (see .github/workflows/docker-publish.yml). Songsue's
# dashboard URL, e.g. https://songsue.vercel.app/dashboard — drives the
# check-in redirect countdown in src/components/NotificationModal.tsx; unset =
# that feature quietly stays disabled (falls back to the plain success message).
ARG NEXT_PUBLIC_SONGSUE_DASHBOARD_URL
ENV NEXT_PUBLIC_SONGSUE_DASHBOARD_URL=$NEXT_PUBLIC_SONGSUE_DASHBOARD_URL

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# pg_dump for the scheduled backup service (scripts/backup-db.mjs, see the `backup`
# service in docker-stack.yml). Falls back to the generic package name if
# postgresql16-client isn't in this Alpine release's repos.
RUN apk add --no-cache postgresql16-client || apk add --no-cache postgresql-client

# Set the correct permission for prerender cache and uploads.
# .uploads-private holds PDPA form docs + payment slips when running without
# Supabase Storage; it must exist and be writable by the nextjs user, and is
# bind-mounted to the host in docker-compose.yml so the data persists.
RUN mkdir -p public/uploads .uploads-private && chown -R nextjs:nodejs public/uploads .uploads-private

# Copy built code and configuration
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
# next build writes to .next by default; the .next.nosync distDir in
# next.config.ts only kicks in on the iCloud-synced local path, never in CI / the
# container (path has no "CloudDocs"/"Mobile Documents"), so copy .next.
COPY --from=builder /app/.next ./.next

# Source + maintenance scripts needed to run migrations/seed/elevate/file-import
# from the Portainer web console (there is no host shell on the swarm). These read
# DATABASE_URL straight from the container env — no .env file required. tsx is
# present because the `deps` stage runs `npm ci` (installs devDependencies too).
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/elevate-admin.ts ./elevate-admin.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
