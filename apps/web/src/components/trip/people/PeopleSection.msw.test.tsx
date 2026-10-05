import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";
import {
  apiUrl,
  changeMemberRole,
  fetchTripAccess,
  removeMember,
  setTravelling,
  type ApiResult,
} from "@/lib/apiClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/account/useSessionUser", () => ({ useSessionUser: () => ({ id: "dev-alice" }) }));

import { PeopleSection } from "./PeopleSection";

// Against the hand-written MSW handlers and the real `apiClient`, not a mocked
// one: `PATCH`/`DELETE /members/:userId` are routes a UI agent works against
// before a server exists (AGENTS.md, Workstreams), so the handler's answer has
// to parse as the `TripAccess` the client expects.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
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
