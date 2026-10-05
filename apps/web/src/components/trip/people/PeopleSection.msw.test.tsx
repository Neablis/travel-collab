import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { makeTripHandlers } from "@/mocks/handlers";

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
