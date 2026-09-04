import { newPageDoc } from "@tc/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import * as pagesClientModule from "@/lib/pagesClient";
import { instantiateDefaults } from "@tc/pages";
import { createPage, deletePage, fetchPage, fetchPages, updatePage } from "@/lib/pagesClient";
import { pageFixture } from "@tc/factories";
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
    expect(result.value.pages).toHaveLength(1);
    expect(result.value.pages[0]!.title).toBe(page.title);
    // PageSummary must not carry `content` — confirms Zod parsing, not passthrough of raw JSON.
    expect((result.value.pages[0] as unknown as { content?: unknown }).content).toBeUndefined();
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

// Mirrors `apiClient.test.ts`'s totality suite, for the same invariant and the
// same reason. This module claimed nothing of the sort until 2026-09-03 — every
// helper `await`ed `fetch` bare, so an offline or DNS failure REJECTED instead
// of resolving an error result, and the `.then(...)` a caller hangs its state
// on never ran. `NotebooksMenu` spun on "Loading…" and disabled its create
// button for the session. Found by CodeRabbit on PR #126.
describe("pagesClient totality — no helper ever rejects", () => {
  const PAGE_ID = "7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
  const CALLS: Record<string, () => Promise<{ ok: boolean; error?: { status: number; message: string } }>> = {
    fetchPages: () => fetchPages(TRIP_ID),
    fetchPage: () => fetchPage(TRIP_ID, PAGE_ID),
    createPage: () =>
      createPage(TRIP_ID, { title: "T", context: { tripId: TRIP_ID }, content: newPageDoc() }),
    updatePage: () => updatePage(TRIP_ID, PAGE_ID, { title: "T" }),
    deletePage: () => deletePage(TRIP_ID, PAGE_ID),
  };

  // The witness: asserts nothing about behaviour, only that the table above is
  // the WHOLE module. Without it a helper added tomorrow is simply missing from
  // the table and the it.each below stays green while covering less.
  it("covers every helper the module exports", () => {
    const exported = Object.entries(pagesClientModule)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    expect(exported.filter((name) => !(name in CALLS))).toEqual([]);
    expect(exported.length).toBe(Object.keys(CALLS).length);
  });

  // Pins the mechanism the suite depends on. If `HttpResponse.error()` ever
  // degraded to a plain non-ok response, every assertion below would stay green
  // while exercising the ordinary HTTP-error path this file already covers —
  // the bug would be back and nothing would say so.
  it("HttpResponse.error() makes a bare fetch reject, not resolve", async () => {
    server.use(http.all("*", () => HttpResponse.error()));
    await expect(fetch("/api/trips/x/pages")).rejects.toThrow();
  });

  it.each(Object.keys(CALLS))("%s resolves { ok: false, status: 0 } when the fetch rejects", async (name) => {
    server.use(http.all("*", () => HttpResponse.error()));
    const result = await CALLS[name]!();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // status 0 is "no response at all", distinct from any HTTP status, so a
    // caller can tell a network failure from a refusal.
    expect(result.error?.status).toBe(0);
    expect(typeof result.error?.message).toBe("string");
  });
});
