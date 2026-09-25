import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "@/server/commands";

const ACTOR_ID = "user-1";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: ACTOR_ID } })),
}));

// Import after the mock so the routes pick up the mocked `auth`.
const { POST: createTrip } = await import("@/app/api/trips/route");
const { POST: postCommand } = await import("@/app/api/trips/[tripId]/commands/route");
const { POST: postBatch } = await import("@/app/api/trips/[tripId]/commands/batch/route");
const { GET: listPages, POST: createPage } = await import("@/app/api/trips/[tripId]/pages/route");
const { PATCH: patchPage } = await import("@/app/api/trips/[tripId]/pages/[pageId]/route");

async function seedTrip() {
  const tripId = randomUUID();
  const result = await executeTripCommand({ type: "CreateTrip", tripId, name: "Rome 2027" }, ACTOR_ID);
  if (!result.ok) throw new Error("failed to seed trip");
  return tripId;
}

const NOT_JSON = "{ this is not json";

const malformed = (url: string, method = "POST") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: NOT_JSON });

// KI-2026-09-05-q / F-E04. `Request.json()` rejects on a body that is not JSON,
// and these five routes awaited it bare — so the rejection escaped the handler
// and Next answered 500 (and Sentry filed a server fault) for what is a client
// error. Called directly here, that escape is a rejected promise rather than a
// 500, which is the same defect one layer down. Every route that reads a body
// through `readBody` belongs in this table.
describe("routes that read a JSON body answer 400, not 500, to malformed JSON", () => {
  it.each([
    ["POST /api/trips", async () => createTrip(malformed("http://test/api/trips"))],
    [
      "POST /api/trips/:id/commands",
      async () => {
        const tripId = await seedTrip();
        return postCommand(malformed(`http://test/api/trips/${tripId}/commands`), {
          params: Promise.resolve({ tripId }),
        });
      },
    ],
    [
      "POST /api/trips/:id/commands/batch",
      async () => {
        const tripId = await seedTrip();
        return postBatch(malformed(`http://test/api/trips/${tripId}/commands/batch`), {
          params: Promise.resolve({ tripId }),
        });
      },
    ],
    [
      "POST /api/trips/:id/pages",
      async () => {
        const tripId = await seedTrip();
        return createPage(malformed(`http://test/api/trips/${tripId}/pages`), {
          params: Promise.resolve({ tripId }),
        });
      },
    ],
    [
      "PATCH /api/trips/:id/pages/:pageId",
      async () => {
        const tripId = await seedTrip();
        // The trip's lazily-seeded Overview page: PATCH checks the page exists
        // before it reads the body, so the id has to name a real one.
        const listed = await listPages(new Request(`http://test/api/trips/${tripId}/pages`), {
          params: Promise.resolve({ tripId }),
        });
        const pageId = ((await listed.json()) as { pages: { id: string }[] }).pages[0]!.id;
        return patchPage(malformed(`http://test/api/trips/${tripId}/pages/${pageId}`, "PATCH"), {
          params: Promise.resolve({ tripId, pageId }),
        });
      },
    ],
  ])("%s", async (_route, call) => {
    const res = await call();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  });
});
