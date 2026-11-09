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

# NEXT_PUBLIC_* are inlined into the browser bundle by `next build`, so they
# must exist here and cannot be set on the running container. Coolify passes
# every environment variable it holds as a build argument; only the ones
# declared here are visible to the build.
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN
ARG NEXT_PUBLIC_PLAUSIBLE_SRC
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ARG NEXT_PUBLIC_VERCEL_ENV
ARG NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
# APP_ENV and PREVIEW_DB_IS_DISPOSABLE are read by the build-time migrate step.
# Unset, it prints that it skipped and the build carries on, which is what a
# production build does. DATABASE_URL is needed in EVERY build, not only a
# preview's: `next build` evaluates `server/config.ts` while collecting page
# data, and that throws without it. Production's build only needs the variable
# to exist; it is the migrate step's gate that decides whether it is used. These
# live in this stage's history and never reach `runtime`.
ARG APP_ENV
ARG PREVIEW_DB_IS_DISPOSABLE
ARG DATABASE_URL

# A build never needs more than this, and the default heap cap is lower than
# what `next build` of this app reaches on an 8 GB box.
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build:container

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app

# The standalone tree is laid out from the tracing root, so the server is at
# apps/web/server.js. `next build` leaves `public/` and `.next/static` out of
# it on purpose; both are copied back beside the server.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
