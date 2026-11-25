# ADR-093: Postgres lives on the box, reached only through a tunnel; images are built in Actions

**Status:** **Accepted 2026-11-24.** Mitchell scoped M64 on 2026-11-24
(`docs/milestones/M64-one-cheap-box-own-postgres.md`, D1–D14).
**Deciders:** Mitchell (product/eng); Claude (drafted).
**Amends:** ADR-091. Production still migrates before it deploys, but the migrate step now
reaches the database through an SSH tunnel, and the deploy pulls an image instead of building one.
**Supersedes, for production and preview hosting:** the Neon choices in ADR-002 and ADR-004.

## Context

Production has run on a Coolify box since M59, but its database stayed on Neon (M59 D3). Two
consequences followed:

- The box had to sit next to Neon's `aws-us-west-2` region. Every page makes several
  sequential queries, so the region was chosen to keep each round trip short.
- A steady stream of work went into letting Neon sleep (ADR-063's and ADR-090's amendments).

The box also ran `next build` (about 4 GB) and Plausible's ClickHouse (1–2 GB idle) beside
production. That forced an 8 GB box, and on 2026-11-14 the builds took production down
(KI-2026-11-14-d).

## Decision

1. **Postgres 17 with pgvector runs on the box as a Coolify resource**, holding three databases:
   `caesura` (production), `caesura_preview` (the one shared preview database), and `umami`
   (analytics). Each has its own role. Postgres **publishes no port to the internet**. The
   applications reach it by its Coolify network name. Its host port is bound to `127.0.0.1` only,
   for the tunnel.
2. **Anything outside the box reaches the database through an SSH tunnel.** GitHub Actions opens
   it with a deploy key, logged in as a dedicated user with no shell. Its `authorized_keys` entry
   limits it to forwarding `127.0.0.1:5432` (`restrict,port-forwarding,permitopen=…`). The
   workflows keep their scripts. `PRODUCTION_DATABASE_URL` names the tunnel's local end, and one
   composite action opens the tunnel for every workflow that needs it.
3. **ADR-091's order holds:** migrate, then check that production has every migration, then
   deploy. A failed migration still deploys nothing. What changes is only how the migrate step
   reaches Postgres.
4. **GitHub Actions builds the image and pushes it to GHCR.** Coolify's `caesura-web` and
   `caesura-preview` are Docker-image applications. A deploy sets the image tag through Coolify's
   API, then deploys. The build runs off the box, and so does the build-time migrate step's
   preview branch (`apps/web/scripts/lib/build-steps.mjs`): a preview migrates
   `caesura_preview` through the same tunnel before its image is deployed.
5. **Backups are nightly `pg_dump`s to Cloudflare R2, kept 14 days**, run as Coolify's
   scheduled S3 backup. A backup counts only after it has been restored once and compared.
   There is no point-in-time restore.

## Consequences

- Neon's point-in-time restore and branches are gone. The worst case is a day of writes lost,
  and a dead box is a restore from R2, not a failover. Mitchell accepted both (M64 D5).
- A query costs a local socket instead of a 65 ms round trip, so the box's region follows the
  users (US east).
- Previews share one database. They were already one at a time (KI-2026-11-14-d). Two previews
  at once would share data, which the label workflow's one-at-a-time rule prevents.
- The box no longer builds, so a merge storm cannot exhaust its memory.
- A new secret class lives in Actions: the tunnel's deploy key and the box's host key. The
  tunnel user can open one port and nothing else.
- Operator tooling that read production through the Neon MCP (`.claude/skills/ai-usage`) reads
  it through the tunnel instead.
