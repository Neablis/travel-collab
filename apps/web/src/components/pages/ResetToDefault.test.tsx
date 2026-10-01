import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    seedKey: "overview",
  });
  // Titled like a seed on purpose: the title does not make a notebook a seed;
  // its seed key does.
  const mine = pageFixture({ id: crypto.randomUUID(), tripId, title: "Bookings", context: { tripId }, actorId: "dev-alice" });
  return { seeded, mine };
}

// "Reset to default" lives behind the notebook's `⋯` since Mitchell's PR #269
// preview (*"reset to default shouldnt be so prominent"*), and the `⋯` is the
// item's own trigger: where the item would not be offered, there is no `⋯`
// either. So "is it offered" is now asked of the `⋯`, and the item is reached
// by opening it.
const MORE = { name: "More notebook actions" };

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
    // Both rendered side by side, so waiting for the seeded one's menu is
    // also waiting out the role read the other one would have needed.
    const menus = await screen.findAllByRole("button", MORE);
    expect(menus).toHaveLength(1);
    await userEvent.click(menus[0]!);
    expect(await screen.findByRole("button", { name: "Reset to default" })).toBeTruthy();
  });

  // Mitchell, 2026-09-27: a default may be renamed. "Money" renamed "Budget"
  // is still the Money default, so it keeps its way back (KI-2026-09-27-e).
  it("is offered on a default notebook the owner renamed", async () => {
    role = "owner";
    const tripId = crypto.randomUUID();
    const renamed = pageFixture({ id: crypto.randomUUID(), tripId, title: "Budget", context: { tripId }, actorId: SYSTEM_ACTOR_ID, seedKey: "money" });
    render(<ResetToDefault tripId={tripId} page={renamed} onReset={() => {}} />);
    await userEvent.click(await screen.findByRole("button", MORE));
    expect(await screen.findByRole("button", { name: "Reset to default" })).toBeTruthy();
  });

  // Mitchell, PR #269 preview: not prominent. The item is not on screen until
  // the reader asks for more, and choosing it still asks before it acts.
  it("stays behind the ⋯ until it is opened, and still confirms", async () => {
    role = "owner";
    const tripId = crypto.randomUUID();
    render(<ResetToDefault tripId={tripId} page={notebooks(tripId).seeded} onReset={() => {}} />);
    const more = await screen.findByRole("button", MORE);
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();

    await userEvent.click(more);
    await userEvent.click(await screen.findByRole("button", { name: "Reset to default" }));
    expect(await screen.findByRole("dialog", { name: "Reset to default?" })).toBeTruthy();
  });

  it("is not offered to an editor, even on a seeded notebook — and neither is an empty ⋯", async () => {
    role = "editor";
    const tripId = crypto.randomUUID();
    render(<ResetToDefault tripId={tripId} page={notebooks(tripId).seeded} onReset={() => {}} />);
    await waitFor(() => expect(accessReads).toBe(1));
    // Join the read the component made, through the cache it made it with:
    // once that has answered, so has the component's, inside `act`.
    await act(async () => {
      await cachedRead(tripKeys.access(tripId), () => fetchTripAccess(tripId));
    });
    expect(screen.queryByRole("button", MORE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
  });
});
