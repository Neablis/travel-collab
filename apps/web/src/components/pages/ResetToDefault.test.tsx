import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { pageFixture } from "@tc/factories";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import { fetchTripAccess } from "@/lib/apiClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { ResetToDefault } from "./ResetToDefault";

// Who sees "Reset to default": the trip's owner, on a notebook that came with
// the trip (Mitchell, 2026-09-27). Each test takes its own trip id, because the
// role read goes through the shared read cache and would otherwise carry one
// test's answer into the next.
let role: "owner" | "editor" = "owner";
let accessReads = 0;
const server = setupServer(
  http.get("/api/trips/:tripId/access", ({ params }) => {
    accessReads += 1;
    return HttpResponse.json({
      access: {
        tripId: params.tripId,
        myRole: role,
        members: [{ userId: "dev-alice", role, name: null, email: null, image: null }],
        invites: [],
        collaboratorsEntitled: true,
      },
    });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  accessReads = 0;
});
afterAll(() => server.close());

function notebooks(tripId: string) {
  const seeded = pageFixture({
    id: crypto.randomUUID(),
    tripId,
    title: "Overview",
    context: { tripId, kind: "overview" },
    actorId: SYSTEM_ACTOR_ID,
  });
  // Titled like a seed on purpose: the title alone does not make a notebook a
  // seed; who made it does.
  const mine = pageFixture({ id: crypto.randomUUID(), tripId, title: "Bookings", context: { tripId }, actorId: "dev-alice" });
  return { seeded, mine };
}

describe("ResetToDefault", () => {
  it("is offered to the owner on a seeded notebook, and not on one they made", async () => {
    role = "owner";
    const tripId = crypto.randomUUID();
    const { seeded, mine } = notebooks(tripId);
    render(
      <>
        <ResetToDefault tripId={tripId} page={seeded} onReset={() => {}} />
        <ResetToDefault tripId={tripId} page={mine} onReset={() => {}} />
      </>,
    );
    // Both rendered side by side, so waiting for the seeded one's button is
    // also waiting out the role read the other one would have needed.
    expect(await screen.findAllByRole("button", { name: "Reset to default" })).toHaveLength(1);
  });

  it("is not offered to an editor, even on a seeded notebook", async () => {
    role = "editor";
    const tripId = crypto.randomUUID();
    render(<ResetToDefault tripId={tripId} page={notebooks(tripId).seeded} onReset={() => {}} />);
    await waitFor(() => expect(accessReads).toBe(1));
    // Join the read the component made, through the cache it made it with:
    // once that has answered, so has the component's, inside `act`.
    await act(async () => {
      await cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId));
    });
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
  });
});
