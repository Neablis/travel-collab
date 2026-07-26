import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { instantiateDefaults } from "@tc/pages";
import { createPage, deletePage, fetchPage, fetchPages, updatePage } from "@/lib/pagesClient";
import { pageFixture } from "@/mocks/fixtures";
import { makePagesHandlers } from "@/mocks/handlers";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("pagesClient", () => {
  it("fetches and schema-validates a page summary list", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    server.use(...makePagesHandlers([page]));
    const result = await fetchPages(TRIP_ID);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.title).toBe(page.title);
    // PageSummary must not carry `content` — confirms Zod parsing, not passthrough of raw JSON.
    expect((result.value[0] as unknown as { content?: unknown }).content).toBeUndefined();
  });

  it("creates a page and round-trips a full Page", async () => {
    server.use(...makePagesHandlers([]));
    const [input] = instantiateDefaults(TRIP_ID);
    const result = await createPage(TRIP_ID, input!);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.tripId).toBe(TRIP_ID);
    expect(result.value.title).toBe(input!.title);
    expect(result.value.id).toBeTruthy();
    expect(result.value.createdAt).toBeTruthy();
  });

  it("fetches a single page by id, and 404s for an unknown id", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    server.use(...makePagesHandlers([page]));
    const found = await fetchPage(TRIP_ID, page.id);
    if (!found.ok) throw new Error("expected ok");
    expect(found.value.id).toBe(page.id);
    const missing = await fetchPage(TRIP_ID, "00000000-0000-4000-8000-000000000000");
    if (missing.ok) throw new Error("expected error");
    expect(missing.error.status).toBe(404);
  });

  it("updates a page and returns the patched Page", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    server.use(...makePagesHandlers([page]));
    const result = await updatePage(TRIP_ID, page.id, { title: "Renamed" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.title).toBe("Renamed");
  });

  it("deletes a page", async () => {
    const page = pageFixture({ tripId: TRIP_ID });
    server.use(...makePagesHandlers([page]));
    const result = await deletePage(TRIP_ID, page.id);
    expect(result.ok).toBe(true);
    const after = await fetchPage(TRIP_ID, page.id);
    if (after.ok) throw new Error("expected error");
    expect(after.error.status).toBe(404);
  });
});
