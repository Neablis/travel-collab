import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { fetchTripDetail, sendTripCommand } from "@/lib/apiClient";
import { tripDetailFixture } from "@/mocks/fixtures";
import { makeTripHandlers } from "@/mocks/handlers";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("apiClient", () => {
  it("fetches and schema-validates a trip detail", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail(fixture.tripId);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.name).toBe("Rome 2027");
  });

  it("sends a command and the mock applies it", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const sent = await sendTripCommand({
      type: "AddDay",
      tripId: fixture.tripId,
      dayId: "44444444-4444-4444-8444-444444444444",
    });
    expect(sent.ok).toBe(true);
    const detail = await fetchTripDetail(fixture.tripId);
    if (!detail.ok) throw new Error("expected ok");
    expect(detail.value.days).toHaveLength(1);
  });

  it("surfaces HTTP errors as typed results", async () => {
    const fixture = tripDetailFixture();
    server.use(...makeTripHandlers(fixture));
    const result = await fetchTripDetail("00000000-0000-4000-8000-000000000000");
    if (result.ok) throw new Error("expected error");
    expect(result.error.status).toBe(404);
  });
});
