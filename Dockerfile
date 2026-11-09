# syntax=docker/dockerfile:1.7
#
# The image Coolify builds and runs (M59; docs/ops/coolify-vps.md). Build from
# the repo root: `docker build --platform linux/amd64 .`
#
# Three stages. `build` is the only one with the toolchain: it migrates the
# preview database when, and only when, `apps/web/scripts/build-migrate.mjs`
# says so (APP_ENV=preview and PREVIEW_DB_IS_DISPOSABLE=true; production is
# migrated by dispatching migrate-production, never here, ADR-004), copies the
# map worker, and runs `next build`. `runtime` is the standalone server and
# nothing else.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
# corepack reads the exact pnpm version, and its hash, from the root
# package.json's `packageManager`, so the box and a laptop install the same pnpm.
RUN corepack enable
WORKDIR /repo

FROM base AS deps
# Manifests only, so a source edit does not reinstall: this layer is rebuilt
# when a package.json or the lockfile changes. One COPY per workspace package
# because a wildcard copy would flatten the directories pnpm needs.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/factories/package.json packages/factories/package.json
COPY packages/fixtures/package.json packages/fixtures/package.json
COPY packages/pages/package.json packages/pages/package.json
COPY packages/predict/package.json packages/predict/package.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .

# Everything the build step reads arrives as a BuildKit secret, because Coolify
# 4.6 with "Use Docker Build Secrets" on passes every variable as
# `--secret id=<NAME>` and sets no build argument at all (verified in its
# ApplicationDeploymentJob: generate_build_secrets, then build_args = ''). So
# an ARG alone is empty on the box. The ARGs below are only the fallback for a
# plain `docker build --build-arg NAME=value` on a laptop; a secret, when
# mounted, wins. NEXT_PUBLIC_* are inlined into the browser bundle by `next
# build`, so they must exist here and cannot be set on the running container;
# they are public, but go through the same path as the rest. APP_ENV and
# PREVIEW_DB_IS_DISPOSABLE gate the build-time migrate: unset, it prints that it
# skipped and the build carries on, which is what a production build does.
ARG APP_ENV
ARG PREVIEW_DB_IS_DISPOSABLE
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ARG NEXT_PUBLIC_PLAUSIBLE_SRC
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ARG NEXT_PUBLIC_VERCEL_ENV
ARG NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA

# A build never needs more than this, and the default heap cap is lower than
# what `next build` of this app reaches on an 8 GB box.
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NEXT_TELEMETRY_DISABLED=1
# The values are exported inside this one RUN only, so they are in no layer, no
# ENV, no `docker history` and no build-log command line. DATABASE_URL is needed
# in EVERY build, not only a preview's: `next build` evaluates `server/config.ts`
# while collecting page data, and that throws without it. Production's build
# only needs it to exist (the migrate gate decides whether it is used), so
# without the secret a placeholder stands in; a preview that lost its secret
# then fails loudly at the first connection, not silently on the wrong database.
# The echo names which branch was taken, never a value.
#
# Fallback if a Coolify without build secrets must be used (leaves the URL in
# this stage's history and the build log, never in the shipped image): add
#   ARG DATABASE_URL
# above this RUN. The loop below already prefers a mounted secret and otherwise
# keeps the ARG.
RUN --mount=type=secret,id=DATABASE_URL,required=false \
    --mount=type=secret,id=APP_ENV,required=false \
    --mount=type=secret,id=PREVIEW_DB_IS_DISPOSABLE,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_PLAUSIBLE_DOMAIN,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_PLAUSIBLE_SRC,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_SENTRY_DSN,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_VERCEL_ENV,required=false \
    --mount=type=secret,id=NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,required=false \
    set -eu; \
    for name in DATABASE_URL APP_ENV PREVIEW_DB_IS_DISPOSABLE NEXT_PUBLIC_PLAUSIBLE_DOMAIN NEXT_PUBLIC_PLAUSIBLE_SRC NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE NEXT_PUBLIC_VERCEL_ENV NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA; do \
      if [ -s "/run/secrets/$name" ]; then export "$name=$(cat "/run/secrets/$name")"; echo "[docker] $name: from build secret"; \
      elif [ -n "$(printenv "$name" || true)" ]; then echo "[docker] $name: from build arg"; \
      else echo "[docker] $name: unset"; fi; \
    done; \
    if [ -z "${DATABASE_URL:-}" ]; then export DATABASE_URL=postgres://build:build@localhost:5432/build; echo "[docker] DATABASE_URL: placeholder"; fi; \
    pnpm --filter web build:container

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# Not `--system`: useradd warns that uid 1001 is above SYS_UID_MAX for one.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --no-create-home --shell /usr/sbin/nologin app

# The standalone tree is laid out from the tracing root, so the server is at
# apps/web/server.js. `next build` leaves `public/` and `.next/static` out of
# it on purpose; both are copied back beside the server.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
# node is already here, and the slim image has neither curl nor wget. The route
# does not touch the database, so a database outage does not restart the app.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
