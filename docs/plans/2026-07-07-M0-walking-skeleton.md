# M0 Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> If anything requires a decision this plan does not cover, STOP and ask Mitchell — do not improvise.

**Goal:** One end-to-end thread through the real architecture: a signed-in user creates a trip in the browser via `UI → API → command pipeline → event appended → projection updated → trips list renders`, with CI and the golden tests guarding it.

**Architecture:** Event-sourced planning domain (scoped substrate, ADR-001/003) inside a Next.js all-in-one app (ADR-002); pure domain in `packages/domain`, Zod contracts in `packages/contracts`, event store + command pipeline in `apps/web/src/server` behind a lint wall. Hybrid dev env (ADR-004).

**Tech Stack:** TypeScript strict, pnpm workspaces, Next.js 15 (App Router, node runtime only), Zod 3, Drizzle + `pg`, Postgres 17 (Docker local / Neon prod), Auth.js (next-auth v5), Vitest, Playwright.

## Global Constraints

- Read `AGENTS.md` before starting. Its invariants override convenience, always.
- Node >= 20, pnpm >= 9. All commands run from the repo root unless stated.
- Package aliases are exactly `@tc/contracts` and `@tc/domain`.
- Every event carries `actor_id`; trips have a `members` list (never an `owner` column); permission checks go through `AccessPolicy` (AGENTS.md invariant 6).
- No direct writes to projection tables outside `src/server/projections.ts` (invariant 1).
- `packages/domain` does no I/O and never reads the clock (invariant 4).
- Node runtime only — never `export const runtime = "edge"` (ADR-004).
- No new dependencies beyond the ones this plan names without asking Mitchell.
- Local Postgres must be running for integration tests: `docker compose up -d`.
- `DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/travel` everywhere; env overrides it.
- Commit after every task with the exact message given (conventional commits).

---

### Task 1: Workspace and local infrastructure

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`

**Interfaces:**
- Produces: workspace layout `packages/*` + `apps/*`; `tsconfig.base.json` for all packages to extend; running Postgres 17 on `localhost:5432` (db `travel`, user/password `postgres`).

- [ ] **Step 1: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:
```json
{
  "name": "travel-collab",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm --filter web lint && node scripts/check-lint-wall.mjs",
    "test": "pnpm -r --if-present test",
    "test:int": "pnpm --filter web test:int",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  }
}
```
(`scripts/check-lint-wall.mjs` arrives in Task 5; `pnpm lint` will fail until then — that's expected.)

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:17
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: travel
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 2s
      retries: 15
volumes:
  pgdata:
```

`.env.example`:
```bash
# Copy to apps/web/.env.local for local dev. Defaults below match docker-compose.
DATABASE_URL=postgres://postgres:postgres@localhost:5432/travel
# Any non-empty string locally; `npx auth secret` for real deployments
AUTH_SECRET=dev-secret-change-me
# Enables the username-only Dev Login provider. NEVER set in production.
AUTH_DEV_LOGIN=true
# Google OAuth (optional locally, required in prod) — console.cloud.google.com
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
```

- [ ] **Step 2: Verify Postgres comes up**

Run: `docker compose up -d && sleep 5 && docker compose exec postgres pg_isready -U postgres`
Expected: `... accepting connections`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: workspace scaffolding, docker postgres, env template"
```

---

### Task 2: Contracts package

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/trip.ts`, `packages/contracts/src/envelope.ts`, `packages/contracts/src/conflict.ts`
- Test: `packages/contracts/test/trip.test.ts`

**Interfaces:**
- Produces (imported as `@tc/contracts` by every later task):
  `CreateTrip` (zod schema + type: `{type:"CreateTrip"; tripId:string; name:string}`),
  `TripCreatedV1` and union `TripEvent` (`{type:"TripCreated"; version:1; payload:{tripId,name,createdBy}}`),
  `TripSummary` (`{tripId; name; members:{userId;role:"owner"}[]; createdAt:string}`),
  `EventEnvelope` (`{streamId; seq; type; version; payload:unknown; actorId; occurredAt:string}`),
  `Conflict`.

- [ ] **Step 1: Create package files**

`packages/contracts/package.json`:
```json
{
  "name": "@tc/contracts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`packages/contracts/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`packages/contracts/src/trip.ts`:
```ts
import { z } from "zod";

export const CreateTrip = z.object({
  type: z.literal("CreateTrip"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateTrip = z.infer<typeof CreateTrip>;

export const TripCreatedV1 = z.object({
  type: z.literal("TripCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    name: z.string().min(1).max(200),
    createdBy: z.string().min(1),
  }),
});
export type TripCreatedV1 = z.infer<typeof TripCreatedV1>;

// Grows into a discriminated union as event types are added (M1+).
export const TripEvent = TripCreatedV1;
export type TripEvent = z.infer<typeof TripEvent>;

export const TripMember = z.object({
  userId: z.string().min(1),
  role: z.literal("owner"),
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  members: z.array(TripMember).min(1),
  createdAt: z.string(), // ISO 8601
});
export type TripSummary = z.infer<typeof TripSummary>;
```

`packages/contracts/src/envelope.ts`:
```ts
import { z } from "zod";

export const EventEnvelope = z.object({
  streamId: z.string().uuid(),
  seq: z.number().int().positive(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  payload: z.unknown(),
  actorId: z.string().min(1),
  occurredAt: z.string(), // ISO 8601
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;
```

`packages/contracts/src/conflict.ts`:
```ts
import { z } from "zod";

// Shape exists from day one (AGENTS.md invariant 3); rules arrive in M1.
export const Conflict = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  subjects: z.array(z.string()),
  description: z.string(),
  resolutions: z.array(z.string()),
});
export type Conflict = z.infer<typeof Conflict>;
```

`packages/contracts/src/index.ts`:
```ts
export * from "./trip";
export * from "./envelope";
export * from "./conflict";
```

- [ ] **Step 2: Write the failing test**

`packages/contracts/test/trip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CreateTrip, TripEvent, TripSummary } from "../src";

describe("trip contracts", () => {
  it("parses a valid CreateTrip command", () => {
    const cmd = CreateTrip.parse({
      type: "CreateTrip",
      tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
      name: "Rome 2027",
    });
    expect(cmd.name).toBe("Rome 2027");
  });

  it("rejects an empty trip name", () => {
    expect(() =>
      CreateTrip.parse({
        type: "CreateTrip",
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "",
      }),
    ).toThrow();
  });

  it("parses TripCreated v1 and requires createdBy", () => {
    const ok = TripEvent.parse({
      type: "TripCreated",
      version: 1,
      payload: {
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "Rome 2027",
        createdBy: "user-1",
      },
    });
    expect(ok.payload.createdBy).toBe("user-1");
    expect(() =>
      TripEvent.parse({
        type: "TripCreated",
        version: 1,
        payload: { tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f", name: "x" },
      }),
    ).toThrow();
  });

  it("requires at least one member on TripSummary", () => {
    expect(() =>
      TripSummary.parse({
        tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
        name: "Rome 2027",
        members: [],
        createdAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Install and run tests**

Run: `pnpm install && pnpm --filter @tc/contracts test`
Expected: 4 passing.

Run: `pnpm --filter @tc/contracts typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(contracts): trip command/event/summary, envelope, conflict schemas"
```

---

### Task 3: Domain — decide and evolve

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`, `packages/domain/src/index.ts`, `packages/domain/src/trip/state.ts`, `packages/domain/src/trip/decide.ts`, `packages/domain/src/trip/evolve.ts`
- Test: `packages/domain/test/trip.test.ts`

**Interfaces:**
- Consumes: `CreateTrip`, `TripEvent` from `@tc/contracts`.
- Produces (imported as `@tc/domain` by server tasks):
  `TripState = { tripId: string; name: string; members: {userId:string; role:"owner"}[] }`,
  `Decision = {ok:true; events:TripEvent[]} | {ok:false; rejection:{code:string; message:string}}`,
  `decideCreateTrip(state: TripState | null, command: CreateTrip, ctx: {actorId:string}): Decision`,
  `evolveTrip(state: TripState | null, event: TripEvent): TripState`.

- [ ] **Step 1: Create package skeleton**

`packages/domain/package.json`:
```json
{
  "name": "@tc/domain",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@tc/contracts": "workspace:*", "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Write the failing tests**

`packages/domain/test/trip.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decideCreateTrip, evolveTrip, type TripState } from "../src";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const cmd = { type: "CreateTrip", tripId: TRIP_ID, name: "Rome 2027" } as const;

describe("decideCreateTrip", () => {
  it("emits TripCreated with the actor as createdBy on fresh state", () => {
    const decision = decideCreateTrip(null, cmd, { actorId: "user-1" });
    if (!decision.ok) throw new Error("expected ok");
    expect(decision.events).toEqual([
      {
        type: "TripCreated",
        version: 1,
        payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1" },
      },
    ]);
  });

  it("rejects when the trip already exists", () => {
    const existing: TripState = {
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
    };
    const decision = decideCreateTrip(existing, cmd, { actorId: "user-1" });
    expect(decision).toEqual({
      ok: false,
      rejection: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    });
  });
});

describe("evolveTrip", () => {
  it("builds state with the creator as the sole member", () => {
    const state = evolveTrip(null, {
      type: "TripCreated",
      version: 1,
      payload: { tripId: TRIP_ID, name: "Rome 2027", createdBy: "user-1" },
    });
    expect(state).toEqual({
      tripId: TRIP_ID,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm install && pnpm --filter @tc/domain test`
Expected: FAIL — cannot resolve `../src` exports.

- [ ] **Step 4: Implement**

`packages/domain/src/trip/state.ts`:
```ts
import type { TripMember } from "@tc/contracts";

export type TripState = {
  tripId: string;
  name: string;
  members: TripMember[];
};
```

`packages/domain/src/trip/decide.ts`:
```ts
import type { CreateTrip, TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

export type Rejection = { code: string; message: string };
export type Decision =
  | { ok: true; events: TripEvent[] }
  | { ok: false; rejection: Rejection };

export type DecideContext = { actorId: string };

export function decideCreateTrip(
  state: TripState | null,
  command: CreateTrip,
  ctx: DecideContext,
): Decision {
  if (state !== null) {
    return {
      ok: false,
      rejection: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    };
  }
  return {
    ok: true,
    events: [
      {
        type: "TripCreated",
        version: 1,
        payload: {
          tripId: command.tripId,
          name: command.name,
          createdBy: ctx.actorId,
        },
      },
    ],
  };
}
```

`packages/domain/src/trip/evolve.ts`:
```ts
import type { TripEvent } from "@tc/contracts";
import type { TripState } from "./state";

export function evolveTrip(state: TripState | null, event: TripEvent): TripState {
  switch (event.type) {
    case "TripCreated":
      return {
        tripId: event.payload.tripId,
        name: event.payload.name,
        members: [{ userId: event.payload.createdBy, role: "owner" }],
      };
  }
}
```

`packages/domain/src/index.ts`:
```ts
export * from "./trip/state";
export * from "./trip/decide";
export * from "./trip/evolve";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain test && pnpm --filter @tc/domain typecheck`
Expected: 3 passing; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(domain): trip decide/evolve with actor-carrying TripCreated"
```

---

### Task 4: Domain — projection function

**Files:**
- Create: `packages/domain/src/trip/project.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/project.test.ts`

**Interfaces:**
- Consumes: `EventEnvelope`, `TripEvent`, `TripSummary` from `@tc/contracts`.
- Produces: `projectTripSummaries(envelopes: EventEnvelope[]): TripSummary[]` — the single definition of the trips read model, used by both live projection and rebuild (golden-test invariant).

- [ ] **Step 1: Write the failing test**

`packages/domain/test/project.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@tc/contracts";
import { projectTripSummaries } from "../src";

const T1 = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const T2 = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";

function envelope(streamId: string, name: string, actorId: string): EventEnvelope {
  return {
    streamId,
    seq: 1,
    type: "TripCreated",
    version: 1,
    payload: { tripId: streamId, name, createdBy: actorId },
    actorId,
    occurredAt: "2026-07-07T12:00:00.000Z",
  };
}

describe("projectTripSummaries", () => {
  it("produces one summary per stream with creator as sole member", () => {
    const summaries = projectTripSummaries([
      envelope(T1, "Rome 2027", "user-1"),
      envelope(T2, "Tokyo 2028", "user-2"),
    ]);
    expect(summaries).toHaveLength(2);
    const rome = summaries.find((s) => s.tripId === T1);
    expect(rome).toEqual({
      tripId: T1,
      name: "Rome 2027",
      members: [{ userId: "user-1", role: "owner" }],
      createdAt: "2026-07-07T12:00:00.000Z",
    });
  });

  it("throws on an unparseable event (replay totality guard)", () => {
    const bad = { ...envelope(T1, "Rome 2027", "user-1"), payload: { nope: true } };
    expect(() => projectTripSummaries([bad])).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @tc/domain test`
Expected: FAIL — `projectTripSummaries` not exported.

- [ ] **Step 3: Implement**

`packages/domain/src/trip/project.ts`:
```ts
import { TripEvent, type EventEnvelope, type TripSummary } from "@tc/contracts";

export function projectTripSummaries(envelopes: EventEnvelope[]): TripSummary[] {
  const byStream = new Map<string, TripSummary>();
  for (const env of envelopes) {
    const event = TripEvent.parse({
      type: env.type,
      version: env.version,
      payload: env.payload,
    });
    switch (event.type) {
      case "TripCreated":
        byStream.set(env.streamId, {
          tripId: event.payload.tripId,
          name: event.payload.name,
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
        });
        break;
    }
  }
  return [...byStream.values()];
}
```

Append to `packages/domain/src/index.ts`:
```ts
export * from "./trip/project";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @tc/domain test`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): pure trip-summaries projection"
```

---

### Task 5: Next.js app scaffold with the lint wall

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/next-env.d.ts` (generated), `apps/web/eslint.config.mjs`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx` (placeholder), `scripts/check-lint-wall.mjs`

**Interfaces:**
- Produces: runnable `pnpm --filter web dev` app; alias `@/*` → `apps/web/src/*`; the lint wall (UI cannot import `@tc/domain` or `@/server/*`; `src/server/**` and `src/app/api/**` are exempt); root `pnpm lint` now works.

- [ ] **Step 1: Create the app manually** (no create-next-app — we control every file)

`apps/web/package.json`:
```json
{
  "name": "web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test:int": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@tc/contracts": "workspace:*",
    "@tc/domain": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "next": "^15.0.0",
    "next-auth": "^5.0.0-beta.25",
    "pg": "^8.12.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3.1.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "drizzle-kit": "^0.28.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```
(If `pnpm install` reports a hard version conflict, prefer the newest stable that installs cleanly and note it in the commit body — do NOT downgrade React below 19 or Next below 15.)

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "ES2022"],
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "allowJs": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tc/contracts", "@tc/domain"],
};

export default nextConfig;
```

`apps/web/src/app/layout.tsx`:
```tsx
export const metadata = { title: "travel-collab" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: "2rem auto", maxWidth: 640 }}>
        {children}
      </body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx` (placeholder, replaced in Task 10):
```tsx
export default function Home() {
  return <main>travel-collab — M0 in progress</main>;
}
```

`apps/web/eslint.config.mjs`:
```js
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // THE LINT WALL (AGENTS.md): UI code may not touch the domain package or
    // server internals. Route handlers and src/server are the exempt shell.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tc/domain", "@tc/domain/*"],
              message: "Only src/server and src/app/api may import the domain package (AGENTS.md lint wall).",
            },
            {
              group: ["@/server/*"],
              message: "UI must call the API, not server internals (AGENTS.md lint wall).",
            },
          ],
        },
      ],
    },
  },
];
```

`scripts/check-lint-wall.mjs`:
```js
import { writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const fixture = "apps/web/src/app/__lint_wall_fixture__.tsx";
writeFileSync(
  fixture,
  'import "@tc/domain";\nexport default function Fixture() { return null; }\n',
);
try {
  execSync("pnpm --filter web exec eslint src/app/__lint_wall_fixture__.tsx", {
    stdio: "pipe",
  });
  console.error("LINT WALL BREACHED: forbidden import was NOT flagged");
  process.exitCode = 1;
} catch {
  console.log("lint wall OK: forbidden import correctly rejected");
} finally {
  rmSync(fixture, { force: true });
}
```

- [ ] **Step 2: Install and verify the app boots**

Run: `pnpm install && pnpm --filter web exec next build`
Expected: build succeeds (generates `next-env.d.ts`; commit it).

- [ ] **Step 3: Verify the lint wall trips**

Run: `pnpm lint`
Expected: web lint passes AND `lint wall OK: forbidden import correctly rejected`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(web): next.js scaffold with enforced lint wall"
```

---

### Task 6: Drizzle schema and migrations

**Files:**
- Create: `apps/web/drizzle.config.ts`, `apps/web/src/server/db/schema.ts`, `apps/web/src/server/db/client.ts`
- Generated: `apps/web/drizzle/0000_*.sql` (commit it)

**Interfaces:**
- Produces: `events` table (`global_seq bigserial PK, stream_id uuid, seq int, type text, version int, payload jsonb, actor_id text, occurred_at timestamptz`, UNIQUE `(stream_id, seq)`), `trip_summaries` table (`trip_id uuid PK, name text, members jsonb, created_at timestamptz`); `db` (drizzle instance over `pg` Pool) and `DATABASE_URL` fallback from `src/server/db/client.ts`.

- [ ] **Step 1: Write schema and config**

`apps/web/src/server/db/schema.ts`:
```ts
import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TripMember } from "@tc/contracts";

export const events = pgTable(
  "events",
  {
    globalSeq: bigserial("global_seq", { mode: "number" }).primaryKey(),
    streamId: uuid("stream_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull(),
    actorId: text("actor_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("events_stream_seq").on(t.streamId, t.seq)],
);

export const tripSummaries = pgTable("trip_summaries", {
  tripId: uuid("trip_id").primaryKey(),
  name: text("name").notNull(),
  members: jsonb("members").$type<TripMember[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});
```

`apps/web/src/server/db/client.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/travel";

const pool = new Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

`apps/web/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/travel",
  },
});
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm --filter web db:generate && pnpm --filter web db:migrate`
Expected: one SQL file appears in `apps/web/drizzle/`; migrate reports success.

- [ ] **Step 3: Verify tables exist**

Run: `docker compose exec postgres psql -U postgres -d travel -c "\dt"`
Expected: `events` and `trip_summaries` listed.

- [ ] **Step 4: Commit** (include the generated `drizzle/` directory)

```bash
git add -A && git commit -m "feat(web): event store + trip_summaries schema and initial migration"
```

---

### Task 7: Event store with optimistic concurrency

**Files:**
- Create: `apps/web/src/server/eventStore.ts`, `apps/web/vitest.config.ts`
- Test: `apps/web/src/server/eventStore.int.test.ts`

**Interfaces:**
- Consumes: `db`, `events` table from Task 6; `EventEnvelope` from `@tc/contracts`.
- Produces:
  `type DomainEvent = { type: string; version: number; payload: unknown }`,
  `appendToStream(tx, args: {streamId; expectedSeq: number; events: DomainEvent[]; actorId; occurredAt: string}): Promise<{ok:true; envelopes: EventEnvelope[]} | {ok:false; code:"concurrency-conflict"}>` (expectedSeq = seq of last event already in the stream; 0 for a new stream),
  `readStream(dbOrTx, streamId): Promise<EventEnvelope[]>`,
  `readAll(dbOrTx): Promise<EventEnvelope[]>` (ordered by `global_seq`).

- [ ] **Step 1: Create vitest config for integration tests**

`apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.int.test.ts"], fileParallelism: false },
});
```

- [ ] **Step 2: Write the failing integration test**

`apps/web/src/server/eventStore.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { events } from "./db/schema";
import { appendToStream, readStream } from "./eventStore";

const NOW = "2026-07-07T12:00:00.000Z";

function tripCreated(tripId: string) {
  return {
    type: "TripCreated",
    version: 1,
    payload: { tripId, name: "Rome 2027", createdBy: "user-1" },
  };
}

describe("event store", () => {
  beforeEach(async () => {
    await db.delete(events);
  });

  it("appends and reads back envelopes in order", async () => {
    const streamId = randomUUID();
    const result = await db.transaction((tx) =>
      appendToStream(tx, {
        streamId,
        expectedSeq: 0,
        events: [tripCreated(streamId)],
        actorId: "user-1",
        occurredAt: NOW,
      }),
    );
    expect(result.ok).toBe(true);
    const stream = await readStream(db, streamId);
    expect(stream).toHaveLength(1);
    expect(stream[0]).toMatchObject({
      streamId,
      seq: 1,
      type: "TripCreated",
      version: 1,
      actorId: "user-1",
    });
    expect(new Date(stream[0]!.occurredAt).toISOString()).toBe(NOW);
  });

  it("returns a typed conflict when two appends race on the same seq", async () => {
    const streamId = randomUUID();
    const append = () =>
      db.transaction((tx) =>
        appendToStream(tx, {
          streamId,
          expectedSeq: 0,
          events: [tripCreated(streamId)],
          actorId: "user-1",
          occurredAt: NOW,
        }),
      );
    const first = await append();
    const second = await append();
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, code: "concurrency-conflict" });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `docker compose up -d && pnpm --filter web test:int`
Expected: FAIL — `./eventStore` does not exist.

- [ ] **Step 4: Implement**

`apps/web/src/server/eventStore.ts`:
```ts
import { asc, eq } from "drizzle-orm";
import type { EventEnvelope } from "@tc/contracts";
import type { Db } from "./db/client";
import { events } from "./db/schema";

export type DomainEvent = { type: string; version: number; payload: unknown };

export type AppendResult =
  | { ok: true; envelopes: EventEnvelope[] }
  | { ok: false; code: "concurrency-conflict" };

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

type EventRow = typeof events.$inferSelect;

function toEnvelope(row: EventRow): EventEnvelope {
  return {
    streamId: row.streamId,
    seq: row.seq,
    type: row.type,
    version: row.version,
    payload: row.payload,
    actorId: row.actorId,
    occurredAt: new Date(row.occurredAt).toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  while (typeof cursor === "object" && cursor !== null) {
    if ((cursor as { code?: string }).code === "23505") return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

export async function appendToStream(
  tx: Queryable,
  args: {
    streamId: string;
    expectedSeq: number;
    events: DomainEvent[];
    actorId: string;
    occurredAt: string;
  },
): Promise<AppendResult> {
  try {
    const rows = await tx
      .insert(events)
      .values(
        args.events.map((e, i) => ({
          streamId: args.streamId,
          seq: args.expectedSeq + 1 + i,
          type: e.type,
          version: e.version,
          payload: e.payload,
          actorId: args.actorId,
          occurredAt: args.occurredAt,
        })),
      )
      .returning();
    return { ok: true, envelopes: rows.map(toEnvelope) };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: "concurrency-conflict" };
    throw err;
  }
}

export async function readStream(q: Queryable, streamId: string): Promise<EventEnvelope[]> {
  const rows = await q
    .select()
    .from(events)
    .where(eq(events.streamId, streamId))
    .orderBy(asc(events.seq));
  return rows.map(toEnvelope);
}

export async function readAll(q: Queryable): Promise<EventEnvelope[]> {
  const rows = await q.select().from(events).orderBy(asc(events.globalSeq));
  return rows.map(toEnvelope);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test:int`
Expected: 2 passing. (Note: the concurrency test relies on the raced transaction failing — Postgres raises `23505` on the second insert.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): event store with optimistic concurrency and typed conflicts"
```

---

### Task 8: Command pipeline, live projection, golden rebuild test

**Files:**
- Create: `apps/web/src/server/accessPolicy.ts`, `apps/web/src/server/projections.ts`, `apps/web/src/server/commands.ts`
- Test: `apps/web/src/server/commands.int.test.ts`

**Interfaces:**
- Consumes: `decideCreateTrip`, `evolveTrip`, `projectTripSummaries` from `@tc/domain`; `appendToStream`, `readStream`, `readAll` from Task 7; `CreateTrip`, `TripEvent` from `@tc/contracts`.
- Produces:
  `AccessPolicy` interface + `soleMemberPolicy` (`canExecute(actorId, commandType, members | null): boolean` — `CreateTrip` allowed for any authenticated actor; everything else requires membership),
  `handleCreateTrip(input: {tripId: string; name: string}, actorId: string): Promise<{ok:true; tripId:string} | {ok:false; error:{code:string; message:string}}>`,
  `applyTripEvents(tx, envelopes): Promise<void>` (the ONLY projection writer),
  `rebuildTripSummaries(): Promise<void>`.

- [ ] **Step 1: Write the failing integration tests**

`apps/web/src/server/commands.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "./db/client";
import { events, tripSummaries } from "./db/schema";
import { handleCreateTrip } from "./commands";
import { rebuildTripSummaries } from "./projections";

describe("handleCreateTrip", () => {
  beforeEach(async () => {
    await db.delete(tripSummaries);
    await db.delete(events);
  });

  it("appends TripCreated with actor and updates the projection", async () => {
    const tripId = randomUUID();
    const result = await handleCreateTrip({ tripId, name: "Rome 2027" }, "user-1");
    expect(result).toEqual({ ok: true, tripId });

    const eventRows = await db.select().from(events);
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]!.actorId).toBe("user-1");

    const summaryRows = await db.select().from(tripSummaries);
    expect(summaryRows).toHaveLength(1);
    expect(summaryRows[0]!.name).toBe("Rome 2027");
    expect(summaryRows[0]!.members).toEqual([{ userId: "user-1", role: "owner" }]);
  });

  it("rejects a duplicate tripId with a typed error", async () => {
    const tripId = randomUUID();
    await handleCreateTrip({ tripId, name: "Rome 2027" }, "user-1");
    const second = await handleCreateTrip({ tripId, name: "Rome again" }, "user-1");
    expect(second).toEqual({
      ok: false,
      error: {
        code: "trip-already-exists",
        message: "A trip with this id already exists.",
      },
    });
  });

  it("rejects invalid input via the contract schema", async () => {
    const result = await handleCreateTrip({ tripId: "not-a-uuid", name: "" }, "user-1");
    expect(result.ok).toBe(false);
  });

  it("GOLDEN: rebuild from the log equals the live projection", async () => {
    await handleCreateTrip({ tripId: randomUUID(), name: "Rome 2027" }, "user-1");
    await handleCreateTrip({ tripId: randomUUID(), name: "Tokyo 2028" }, "user-2");

    const live = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));
    await rebuildTripSummaries();
    const rebuilt = await db.select().from(tripSummaries).orderBy(asc(tripSummaries.tripId));

    const normalize = (rows: typeof live) =>
      rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
    expect(normalize(rebuilt)).toEqual(normalize(live));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test:int`
Expected: FAIL — `./commands` does not exist.

- [ ] **Step 3: Implement**

`apps/web/src/server/accessPolicy.ts`:
```ts
import type { TripMember } from "@tc/contracts";

export interface AccessPolicy {
  canExecute(
    actorId: string,
    commandType: string,
    members: TripMember[] | null,
  ): boolean;
}

// Phase 1: single-player. Creating is open to any authenticated actor;
// everything else requires membership. Phase 2 swaps this implementation,
// never the callers (AGENTS.md invariant 6c).
export const soleMemberPolicy: AccessPolicy = {
  canExecute(actorId, commandType, members) {
    if (commandType === "CreateTrip") return true;
    return members?.some((m) => m.userId === actorId) ?? false;
  },
};
```

`apps/web/src/server/projections.ts`:
```ts
import { TripEvent, type EventEnvelope } from "@tc/contracts";
import { projectTripSummaries } from "@tc/domain";
import { db, type Db } from "./db/client";
import { tripSummaries } from "./db/schema";
import { readAll } from "./eventStore";

type Queryable = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// The ONLY code allowed to write trip_summaries (AGENTS.md invariant 1).
export async function applyTripEvents(
  tx: Queryable,
  envelopes: EventEnvelope[],
): Promise<void> {
  for (const env of envelopes) {
    const event = TripEvent.parse({
      type: env.type,
      version: env.version,
      payload: env.payload,
    });
    switch (event.type) {
      case "TripCreated":
        await tx.insert(tripSummaries).values({
          tripId: event.payload.tripId,
          name: event.payload.name,
          members: [{ userId: event.payload.createdBy, role: "owner" }],
          createdAt: env.occurredAt,
        });
        break;
    }
  }
}

export async function rebuildTripSummaries(): Promise<void> {
  await db.transaction(async (tx) => {
    const envelopes = await readAll(tx);
    const summaries = projectTripSummaries(envelopes);
    await tx.delete(tripSummaries);
    for (const s of summaries) {
      await tx.insert(tripSummaries).values(s);
    }
  });
}

export async function listTripSummaries() {
  return db.select().from(tripSummaries);
}
```

`apps/web/src/server/commands.ts`:
```ts
import { CreateTrip, TripEvent } from "@tc/contracts";
import { decideCreateTrip, evolveTrip, type TripState } from "@tc/domain";
import { db } from "./db/client";
import { appendToStream, readStream } from "./eventStore";
import { applyTripEvents } from "./projections";
import { soleMemberPolicy } from "./accessPolicy";

export type CommandResult =
  | { ok: true; tripId: string }
  | { ok: false; error: { code: string; message: string } };

// The command pipeline (docs/guidelines/building-the-parts.md). Every write
// in the planning domain goes through this exact sequence.
export async function handleCreateTrip(
  input: { tripId: string; name: string },
  actorId: string,
): Promise<CommandResult> {
  // 1. validate the command against the contract
  const parsed = CreateTrip.safeParse({ type: "CreateTrip", ...input });
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid-command", message: parsed.error.message },
    };
  }
  const command = parsed.data;

  return db.transaction(async (tx): Promise<CommandResult> => {
    // 2. load the stream and fold to current state
    const history = await readStream(tx, command.tripId);
    let state: TripState | null = null;
    for (const env of history) {
      const event = TripEvent.parse({
        type: env.type,
        version: env.version,
        payload: env.payload,
      });
      state = evolveTrip(state, event);
    }

    // 3. authorize via the AccessPolicy seam
    if (!soleMemberPolicy.canExecute(actorId, command.type, state?.members ?? null)) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this trip." } };
    }

    // 4. decide
    const decision = decideCreateTrip(state, command, { actorId });
    if (!decision.ok) return { ok: false, error: decision.rejection };

    // 5. append with optimistic concurrency
    const appended = await appendToStream(tx, {
      streamId: command.tripId,
      expectedSeq: history.length,
      events: decision.events,
      actorId,
      occurredAt: new Date().toISOString(),
    });
    if (!appended.ok) {
      return {
        ok: false,
        error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
      };
    }

    // 6. update projections in the same transaction
    await applyTripEvents(tx, appended.envelopes);

    return { ok: true, tripId: command.tripId };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test:int`
Expected: 6 passing (2 event store + 4 pipeline/golden).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): command pipeline with AccessPolicy seam, projection, golden rebuild test"
```

---

### Task 9: Auth.js — Google plus hermetic Dev Login

**Files:**
- Create: `apps/web/src/server/auth.ts`, `apps/web/src/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**
- Consumes: env vars from `.env.example`.
- Produces: `auth(): Promise<Session | null>` where `session.user.id` is the stable actor id; sign-in page at `/api/auth/signin`. Dev Login (username-only Credentials provider) exists ONLY when `AUTH_DEV_LOGIN=true` — used locally and in CI so e2e never needs Google.

- [ ] **Step 1: Implement auth config**

`apps/web/src/server/auth.ts`:
```ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";

const providers: Provider[] = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

if (process.env.AUTH_DEV_LOGIN === "true") {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev Login",
      credentials: { username: { label: "Username" } },
      authorize: async (credentials) => {
        const username = typeof credentials?.username === "string" ? credentials.username.trim() : "";
        if (!username) return null;
        return { id: `dev-${username}`, name: username };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  callbacks: {
    jwt: ({ token, user }) => {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = (token.userId as string | undefined) ?? token.sub ?? "";
      return session;
    },
  },
});
```

`apps/web/src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/server/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 2: Verify locally**

Create `apps/web/.env.local` from `.env.example` (leave Google vars empty). Run: `pnpm --filter web dev`, open `http://localhost:3000/api/auth/signin`.
Expected: the built-in sign-in page shows "Sign in with Dev Login" with a Username field; entering `alice` signs in and redirects.

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter web typecheck`
Expected: exits 0. (If `session.user.id` errors, add `apps/web/src/types/next-auth.d.ts`:)
```ts
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; email?: string | null; image?: string | null };
  }
}
```

```bash
git add -A && git commit -m "feat(web): auth.js with google and CI-safe dev login provider"
```

---

### Task 10: API routes and the trips UI

**Files:**
- Create: `apps/web/src/app/api/trips/route.ts`
- Modify: `apps/web/src/app/page.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `auth` (Task 9), `handleCreateTrip` (Task 8), `listTripSummaries` (Task 8), `TripSummary` from `@tc/contracts`.
- Produces: `GET /api/trips` → `401` or `{trips: TripSummary[]}` (only trips where the caller is a member); `POST /api/trips` body `{name: string}` → `401`, `400 {error}`, or `201 {tripId}`.

- [ ] **Step 1: Implement the route handler**

`apps/web/src/app/api/trips/route.ts`:
```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/server/auth";
import { handleCreateTrip } from "@/server/commands";
import { listTripSummaries } from "@/server/projections";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const rows = await listTripSummaries();
  const trips = rows.filter((r) => r.members.some((m) => m.userId === userId));
  return Response.json({ trips });
}

const CreateTripBody = z.object({ name: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = CreateTripBody.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "name is required (1-200 chars)" }, { status: 400 });
  }
  const result = await handleCreateTrip(
    { tripId: randomUUID(), name: body.data.name },
    session.user.id,
  );
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json({ tripId: result.tripId }, { status: 201 });
}
```

- [ ] **Step 2: Implement the page**

`apps/web/src/app/page.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { TripSummary } from "@tc/contracts";

export default function Home() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/trips");
    if (res.status === 401) {
      setUnauthenticated(true);
      return;
    }
    const data = (await res.json()) as { trips: TripSummary[] };
    setUnauthenticated(false);
    setTrips(data.trips);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Something went wrong");
      return;
    }
    setName("");
    await load();
  }

  if (unauthenticated) {
    return (
      <main>
        <h1>travel-collab</h1>
        <a href="/api/auth/signin?callbackUrl=/">Sign in</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Your trips</h1>
      <form onSubmit={createTrip}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trip name"
          aria-label="Trip name"
        />
        <button type="submit">Create trip</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {(trips ?? []).map((t) => (
          <li key={t.tripId}>{t.name}</li>
        ))}
      </ul>
      {trips !== null && trips.length === 0 && <p>No trips yet — create one.</p>}
    </main>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `docker compose up -d && pnpm --filter web dev`. Sign in via Dev Login as `alice`, create "Rome 2027".
Expected: trip appears in the list; `docker compose exec postgres psql -U postgres -d travel -c "select stream_id, seq, type, actor_id from events"` shows one row with `actor_id = dev-alice`.

- [ ] **Step 4: Lint, typecheck, commit**

Run: `pnpm lint && pnpm --filter web typecheck`
Expected: clean (page imports only `@tc/contracts` — the wall holds).

```bash
git add -A && git commit -m "feat(web): trips api and create/list ui through the command pipeline"
```

---

### Task 11: Playwright e2e smoke

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts`
- Modify: `apps/web/package.json` (add script + dependency)

**Interfaces:**
- Consumes: the running app with `AUTH_DEV_LOGIN=true` and Postgres up.
- Produces: `pnpm --filter web test:e2e` — THE M0 happy path, kept green forever (AGENTS.md testing model).

- [ ] **Step 1: Add Playwright**

Run: `pnpm --filter web add -D @playwright/test && pnpm --filter web exec playwright install chromium`

Add to `apps/web/package.json` scripts: `"test:e2e": "playwright test"`.

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_DEV_LOGIN: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/travel",
    },
  },
});
```

- [ ] **Step 2: Write the smoke test**

`apps/web/e2e/smoke.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("sign in, create a trip, see it in the list", async ({ page }) => {
  const tripName = `Rome ${Date.now()}`;

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();

  // Auth.js built-in sign-in page: Dev Login credentials form.
  await page.fill('input[name="username"]', "alice");
  await page.getByRole("button", { name: /sign in with dev login/i }).click();

  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await page.getByLabel("Trip name").fill(tripName);
  await page.getByRole("button", { name: "Create trip" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: tripName })).toBeVisible();
});
```

- [ ] **Step 3: Run it**

Run: `docker compose up -d && pnpm --filter web test:e2e`
Expected: 1 passing. If the sign-in button selector fails, open the Playwright trace, read the actual button text on `/api/auth/signin`, adjust the selector to match, and note the change in the commit body.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(web): playwright m0 happy-path smoke"
```

---

### Task 12: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: every script defined above.
- Produces: the merge gate — typecheck, lint (incl. lint-wall proof), unit, integration (Postgres service), e2e. **Requires a GitHub remote: if `git remote -v` is empty, STOP and ask Mitchell to create the repo before this task.**

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

env:
  DATABASE_URL: postgres://postgres:postgres@localhost:5432/travel
  AUTH_SECRET: ci-secret
  AUTH_DEV_LOGIN: "true"

jobs:
  checks:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: travel
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 2s --health-timeout 2s --health-retries 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm --filter web db:migrate
      - run: pnpm --filter web test:int
      - run: pnpm --filter web exec playwright install chromium --with-deps
      - run: pnpm --filter web build
      - run: pnpm --filter web test:e2e
```

- [ ] **Step 2: Push and verify**

Run: `git add -A && git commit -m "ci: typecheck, lint wall, unit, integration, e2e pipeline" && git push`
Expected: workflow green on GitHub (`gh run watch` if `gh` is available). If it fails, fix forward until green — this task is not done at yellow.

---

### Task 13: Deploy to Vercel + Neon (WITH MITCHELL — stop at each ⚠)

**Files:** none (dashboard work + one command)

- [ ] **Step 1 ⚠:** Ask Mitchell to create a Neon project (Postgres 17) and provide the **pooled** connection string, and to create a Google OAuth client (authorized redirect: `https://<vercel-domain>/api/auth/callback/google`) with its client id/secret.
- [ ] **Step 2:** Run the migration against Neon: `DATABASE_URL='<neon-pooled-url>' pnpm --filter web db:migrate` (explicit step — never at runtime, ADR-004).
- [ ] **Step 3 ⚠:** Ask Mitchell to import the GitHub repo in Vercel with **Root Directory = `apps/web`**, and set env vars: `DATABASE_URL` (pooled Neon), `AUTH_SECRET` (from `npx auth secret`), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. **Do NOT set `AUTH_DEV_LOGIN` in production.**
- [ ] **Step 4:** Verify on the production URL: sign in with Google, create a trip, see it listed. Verify a PR gets a preview deployment.
- [ ] **Step 5:** Commit any config fixes that were needed: `git commit -m "chore: production deployment fixes"`

---

### Task 14: Gate ceremony

**Files:**
- Modify: `docs/milestones/M0-walking-skeleton.md` (retro note), `TODO.md` (check M0), `README.md` (status line)

- [ ] **Step 1:** Walk `docs/milestones/M0-walking-skeleton.md` exit-gate checklist top to bottom, running each verification for real. Any unchecked item = M0 not done.
- [ ] **Step 2:** Append a retro note to the milestone file: what we learned, what changed vs plan, what M1 should know.
- [ ] **Step 3:** Check the M0 box in `TODO.md`; update `README.md` status to "M0 complete, M1 next".
- [ ] **Step 4 ⚠:** Present the gate evidence to Mitchell for explicit go/no-go on M1.

```bash
git add -A && git commit -m "docs: m0 gate passed — retro note and roadmap tick"
```
