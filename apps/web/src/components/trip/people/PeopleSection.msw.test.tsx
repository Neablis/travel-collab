import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Guest } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import {
  apiUrl,
  changeMemberRole,
  createGuest,
  fetchTripAccess,
  linkGuest,
  removeGuest,
  removeMember,
  setTravelling,
  unlinkGuest,
  updateGuest,
  type ApiResult,
} from "@/lib/apiClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// Mutable so a suite can read as someone other than the owner — the guest
// self-claim is the one affordance a viewer holds.
let sessionUserId: string | null = "dev-alice";
vi.mock("@/components/account/useSessionUser", () => ({ useSessionUser: () => ({ id: sessionUserId }) }));

import { PeopleSection } from "./PeopleSection";

// Against the hand-written MSW handlers and the real `apiClient`, not a mocked
// one: `PATCH`/`DELETE /members/:userId` are routes a UI agent works against
// before a server exists (AGENTS.md, Workstreams), so the handler's answer has
// to parse as the `TripAccess` the client expects.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  sessionUserId = "dev-alice";
  cleanup();
});
afterAll(() => server.close());

const detail = tripDetailFixture({
  members: [
    { userId: "dev-alice", role: "owner" },
    { userId: "dev-bob", role: "editor" },
  ],
});

it("moves a member to Not travelling through the mock's PATCH", async () => {
  server.use(...makeTripHandlers(detail));
  render(<PeopleSection tripId={detail.tripId} />);
  await screen.findByRole("list", { name: "Travelling · 2" });

  fireEvent.click(screen.getByRole("button", { name: "Actions for Bob" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Mark as not travelling" }));

  const not = await screen.findByRole("list", { name: "Not travelling · 1" });
  expect(within(not).getByText("Bob")).toBeTruthy();
});

it("takes a member off the list through the mock's DELETE", async () => {
  server.use(...makeTripHandlers(detail));
  render(<PeopleSection tripId={detail.tripId} />);
  await screen.findByRole("list", { name: "Travelling · 2" });

  fireEvent.click(screen.getByRole("button", { name: "Actions for Bob" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Remove from trip…" }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));

  expect(await screen.findByText("People · 1")).toBeTruthy();
  expect(screen.queryByText("Bob")).toBeNull();
});

// The handler answered 200 to anything, so a UI written against it never met
// the refusals the route gives (`members/[userId]/route.ts`). Each status
// here is one the route's int test pins.
describe("the mock's member writes refuse as the route does", () => {
  const status = async (result: Promise<ApiResult<unknown>>) => {
    const answered = await result;
    return answered.ok ? 200 : answered.error.status;
  };

  it("404s someone who is not on the trip", async () => {
    server.use(...makeTripHandlers(detail));
    expect(await status(removeMember(detail.tripId, "dev-nobody"))).toBe(404);
    expect(await status(setTravelling(detail.tripId, "dev-nobody", false))).toBe(404);
    expect(await status(changeMemberRole(detail.tripId, "dev-nobody", "viewer"))).toBe(404);
  });

  it("409s the owner as the target of a removal or a role change", async () => {
    server.use(...makeTripHandlers(detail));
    expect(await status(removeMember(detail.tripId, "dev-alice"))).toBe(409);
    expect(await status(changeMemberRole(detail.tripId, "dev-alice", "viewer"))).toBe(409);
  });

  it("403s a member acting on someone else, and lets them set their own travelling", async () => {
    server.use(...makeTripHandlers(detail, { myRole: "editor", viewerId: "dev-bob" }));
    expect(await status(setTravelling(detail.tripId, "dev-alice", false))).toBe(403);
    expect(await status(removeMember(detail.tripId, "dev-alice"))).toBe(403);
    expect(await status(changeMemberRole(detail.tripId, "dev-bob", "viewer"))).toBe(403);
    expect(await status(setTravelling(detail.tripId, "dev-bob", false))).toBe(200);
  });

  it("400s a body that is neither change", async () => {
    server.use(...makeTripHandlers(detail));
    const res = await fetch(apiUrl(`/api/trips/${detail.tripId}/members/dev-bob`), {
      method: "PATCH",
      body: JSON.stringify({ travelling: false, role: "viewer" }),
    });
    expect(res.status).toBe(400);
  });

  // W22: the section orders reads by it, so a write's answer has to carry one
  // newer than the read it follows.
  it("answers a write with an access revision past the read's", async () => {
    server.use(...makeTripHandlers(detail));
    const read = await fetchTripAccess(detail.tripId);
    const written = await setTravelling(detail.tripId, "dev-bob", false);
    if (!read.ok || !written.ok) throw new Error("expected both to answer");
    expect(Number(written.value.accessRev)).toBeGreaterThan(Number(read.value.accessRev));
  });
});

// ---------------------------------------------------------------------------
// Guests (guests spec P1, part 3). The section reads the v1 endpoints beside
// the members, and the row's one menu holds only what the reader may do —
// the same rule the member rows follow.
// ---------------------------------------------------------------------------

const guestDetail = tripDetailFixture({
  members: [
    { userId: "dev-alice", role: "owner" },
    { userId: "dev-bob", role: "editor" },
    { userId: "dev-carol", role: "viewer" },
  ],
});

function guestFixture(name: string, overrides?: Partial<Guest>): Guest {
  return {
    guestId: `guest_mock_${name.toLowerCase()}`,
    tripId: guestDetail.tripId,
    name,
    travelling: true,
    linkedUserId: null,
    createdBy: "dev-alice",
    createdAt: "2026-10-15T00:00:00.000Z",
    ...overrides,
  };
}

async function addGuestNamed(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Add guest" }));
  fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  await screen.findByText("Guests · 1");
}

describe("the Guests section", () => {
  it("adds a guest through the section's form", async () => {
    server.use(...makeTripHandlers(guestDetail));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    await screen.findByText("Guests · 0");

    await addGuestNamed("Grandma");

    const row = screen.getByTestId("guest-row");
    expect(within(row).getByText("Grandma")).toBeTruthy();
    expect(within(row).getByText("Guest")).toBeTruthy();
    expect(within(row).getByText("Travelling")).toBeTruthy();
  });

  it("refuses an empty name before the round trip", async () => {
    server.use(...makeTripHandlers(guestDetail));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    await screen.findByText("Guests · 0");

    fireEvent.click(screen.getByRole("button", { name: "Add guest" }));
    fireEvent.change(screen.getByLabelText("Guest name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await screen.findByRole("alert");
    expect(screen.getByText("Guests · 0")).toBeTruthy();
  });

  it("marks a guest as not travelling from their row's menu", async () => {
    server.use(...makeTripHandlers(guestDetail, { guests: [guestFixture("Grandma")] }));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    const row = await screen.findByTestId("guest-row");

    fireEvent.click(within(row).getByRole("button", { name: "Actions for Grandma" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as not travelling" }));

    await within(row).findByText("Not travelling");
  });

  // The line says what the Part 2 overlay divides by: members and travelling
  // guests both (`server/access/overlay.ts`), through `travellerIds`.
  it("counts travelling guests in the cost split line", async () => {
    server.use(...makeTripHandlers(guestDetail, { guests: [guestFixture("Grandma")] }));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    expect(await screen.findByText("Costs are split across 4 travellers.")).toBeTruthy();
  });

  it("leaves a not-travelling guest out of the cost split line", async () => {
    server.use(...makeTripHandlers(guestDetail, { guests: [guestFixture("Grandma", { travelling: false })] }));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    expect(await screen.findByText("Costs are split across 3 travellers.")).toBeTruthy();
  });

  it("the owner links a guest to a member, then unlinks them", async () => {
    server.use(...makeTripHandlers(guestDetail, { guests: [guestFixture("Grandma")] }));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    const row = await screen.findByTestId("guest-row");

    fireEvent.click(within(row).getByRole("button", { name: "Actions for Grandma" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Link to a member…" }));
    const dialog = await screen.findByRole("dialog", { name: "Link Grandma to a member" });
    fireEvent.change(within(dialog).getByLabelText("Member"), { target: { value: "dev-bob" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Link$/ }));

    await within(row).findByText(/linked to Bob/);

    fireEvent.click(within(row).getByRole("button", { name: "Actions for Grandma" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unlink…" }));
    const confirm = await screen.findByRole("dialog", { name: "Unlink Grandma?" });
    fireEvent.click(within(confirm).getByRole("button", { name: /^Unlink$/ }));

    await waitFor(() => expect(within(row).queryByText(/linked to/)).toBeNull());
  });

  it("removes a guest through the confirm", async () => {
    server.use(...makeTripHandlers(guestDetail, { guests: [guestFixture("Grandma")] }));
    render(<PeopleSection tripId={guestDetail.tripId} />);
    const row = await screen.findByTestId("guest-row");

    fireEvent.click(within(row).getByRole("button", { name: "Actions for Grandma" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove guest…" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Grandma from the trip?" });
    fireEvent.click(within(confirm).getByRole("button", { name: /^Remove$/ }));

    await screen.findByText("Guests · 0");
    expect(screen.queryByTestId("guest-row")).toBeNull();
  });

  it("a viewer reads the list and may only claim a record for themselves", async () => {
    sessionUserId = "dev-carol";
    server.use(
      ...makeTripHandlers(guestDetail, {
        myRole: "viewer",
        viewerId: "dev-carol",
        guests: [guestFixture("Grandma")],
      }),
    );
    render(<PeopleSection tripId={guestDetail.tripId} />);
    const row = await screen.findByTestId("guest-row");

    // Read-only: no add affordance, no travelling toggle, no remove.
    expect(screen.queryByRole("button", { name: "Add guest" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Actions for Grandma" }));
    expect(screen.queryByRole("menuitem", { name: "Mark as not travelling" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Remove guest…" })).toBeNull();

    // The one thing they may do: the self-claim.
    fireEvent.click(screen.getByRole("menuitem", { name: "Claim as me" }));
    await within(row).findByText(/linked to Carol/);
  });
});

describe("the mock's guest writes refuse as the v1 routes do", () => {
  const status = async (result: Promise<ApiResult<unknown>>) => {
    const answered = await result;
    return answered.ok ? 200 : answered.error.status;
  };
  const message = async (result: Promise<ApiResult<unknown>>) => {
    const answered = await result;
    return answered.ok ? null : answered.error.message;
  };

  it("403s a viewer managing guests, with the v1 envelope's message", async () => {
    server.use(...makeTripHandlers(guestDetail, { myRole: "viewer", viewerId: "dev-carol" }));
    expect(await status(createGuest(guestDetail.tripId, "Grandma"))).toBe(403);
    // The new failure mode `readV1Json` covers: the internal envelope's
    // reader would print "[object Object]" for this refusal.
    expect(await message(createGuest(guestDetail.tripId, "Grandma"))).toBe(
      "Only the trip's owner or an editor can manage guests.",
    );
    expect(await status(updateGuest(guestDetail.tripId, "guest_mock_grandma", { travelling: false }))).toBe(403);
    expect(await status(removeGuest(guestDetail.tripId, "guest_mock_grandma"))).toBe(403);
    expect(await status(unlinkGuest(guestDetail.tripId, "guest_mock_grandma"))).toBe(403);
  });

  it("lets an editor manage guests but not link for someone else or unlink", async () => {
    server.use(
      ...makeTripHandlers(guestDetail, {
        myRole: "editor",
        viewerId: "dev-bob",
        guests: [guestFixture("Grandma")],
      }),
    );
    expect(await status(createGuest(guestDetail.tripId, "Baby"))).toBe(200);
    expect(await status(updateGuest(guestDetail.tripId, "guest_mock_grandma", { travelling: false }))).toBe(200);
    expect(await status(linkGuest(guestDetail.tripId, "guest_mock_grandma", "dev-alice"))).toBe(403);
    expect(await status(linkGuest(guestDetail.tripId, "guest_mock_grandma", "dev-bob"))).toBe(200);
    expect(await status(unlinkGuest(guestDetail.tripId, "guest_mock_grandma"))).toBe(403);
  });

  it("404s an unknown guest and 400s an empty name", async () => {
    server.use(...makeTripHandlers(guestDetail));
    expect(await status(updateGuest(guestDetail.tripId, "guest_nope", { travelling: false }))).toBe(404);
    expect(await status(removeGuest(guestDetail.tripId, "guest_nope"))).toBe(404);
    expect(await status(createGuest(guestDetail.tripId, "   "))).toBe(400);
  });
});
