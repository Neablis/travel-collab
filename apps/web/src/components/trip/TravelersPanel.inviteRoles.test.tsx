import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

// Review of #309, finding 2.4: the picker's options were a hand-written list,
// so a role added to `InviteRole` would be invitable by API and missing from
// the one screen an owner invites from. Its own file because the contract is
// mocked for the whole module graph: `InviteRole` gains a role the real one
// does not have, and the picker has to offer it without being edited.
vi.mock("@tc/contracts", async (orig) => {
  const actual = await orig<typeof import("@tc/contracts")>();
  return { ...actual, InviteRole: z.enum([...actual.InviteRole.options, "co-pilot"]) };
});

vi.mock("@/lib/apiClient", () => ({
  fetchTripAccess: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      tripId: "t",
      myRole: "owner",
      members: [{ userId: "dev-alice", role: "owner", name: "Alice", email: null, image: null }],
      invites: [],
      collaboratorsEntitled: true,
    },
  }),
  createTripInvite: vi.fn(),
  revokeTripInvite: vi.fn(),
  inviteLink: (token: string) => `http://test/invite/${token}`,
}));

// After `zod`: importing the mocked module runs the factory above, which needs `z`.
import { InviteRole } from "@tc/contracts";
import { TravelersPanel } from "./TravelersPanel";

afterEach(cleanup);

it("offers every role the contract makes invitable, a new one included", async () => {
  render(<TravelersPanel tripId="t" />);
  await screen.findByText("Alice");

  const picker = screen.getByRole("combobox", { name: "Invite role" });
  const offered = within(picker)
    .getAllByRole("option")
    .map((o) => (o as HTMLOptionElement).value);
  // `InviteRole` here is the mocked one, so the expectation follows the real
  // contract as it grows; `co-pilot` is named to prove the mock took effect.
  expect(offered).toContain("co-pilot");
  expect([...offered].sort()).toEqual([...InviteRole.options].sort());
});
