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
  createTripInvite: vi.fn(),
  inviteLink: (token: string) => `http://test/invite/${token}`,
}));

// After `zod`: importing the mocked module runs the factory above, which needs `z`.
import { InviteRole } from "@tc/contracts";
import { InviteDialog } from "./InviteDialog";

afterEach(cleanup);

it("offers every role the contract makes invitable, a new one included", () => {
  render(<InviteDialog tripId="t" open onOpenChange={() => {}} gated={false} onCreated={() => {}} />);

  // A segmented control carries no option values in the DOM, so the count is
  // the handle: the mocked `InviteRole` has four, the real one three.
  const offered = within(screen.getByRole("radiogroup", { name: "Role" })).getAllByRole("radio");
  expect(InviteRole.options).toContain("co-pilot");
  expect(offered).toHaveLength(InviteRole.options.length);
});
