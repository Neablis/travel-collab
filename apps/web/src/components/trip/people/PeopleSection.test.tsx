import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripAccess, TripInvite } from "@tc/contracts";

const fetchTripAccessMock = vi.fn();
const createTripInviteMock = vi.fn();
const revokeTripInviteMock = vi.fn();
const setTravellingMock = vi.fn();
const changeMemberRoleMock = vi.fn();
const removeMemberMock = vi.fn();
const leaveTripMock = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  fetchTripAccess: (...args: unknown[]) => fetchTripAccessMock(...args),
  createTripInvite: (...args: unknown[]) => createTripInviteMock(...args),
  revokeTripInvite: (...args: unknown[]) => revokeTripInviteMock(...args),
  setTravelling: (...args: unknown[]) => setTravellingMock(...args),
  changeMemberRole: (...args: unknown[]) => changeMemberRoleMock(...args),
  removeMember: (...args: unknown[]) => removeMemberMock(...args),
  leaveTrip: (...args: unknown[]) => leaveTripMock(...args),
  inviteLink: (token: string) => `http://test/invite/${token}`,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

// Who is reading. The owner by default, which is who most of these tests are.
let meId: string | undefined = "dev-alice";
vi.mock("@/components/account/useSessionUser", () => ({
  useSessionUser: () => (meId === undefined ? undefined : { id: meId }),
}));

import { PeopleSection } from "./PeopleSection";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const invite: TripInvite = {
  inviteId: "1b3d5f70-1111-4222-8333-444455556666",
  tripId,
  // Deliberately a different address from any member's below, so an
  // assertion about the member list cannot accidentally match the invite row.
  email: "cara@example.com",
  role: "viewer",
  status: "pending",
  token: "tok-123",
  invitedBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  acceptedBy: null,
  acceptedAt: null,
  revokedAt: null,
  travelling: true,
};

const alice = { userId: "dev-alice", role: "owner" as const, name: "Alice", email: null, image: null, travelling: true };
const bob = { userId: "dev-bob", role: "editor" as const, name: null, email: "bob@example.com", image: null, travelling: true };

function access(overrides: Partial<TripAccess> = {}): TripAccess {
  return {
    tripId,
    myRole: "owner",
    members: [alice, bob],
    invites: [invite],
    // M20 link 6. The default is entitled, so every test written before the
    // collaboration gate keeps describing the behaviour it was written for.
    collaboratorsEntitled: true,
    ...overrides,
  };
}

const writeText = vi.fn().mockResolvedValue(undefined);

/** Opens a row's `⋯` menu. A plain click, as ADR-012 invariant 3 requires of every overlay. */
function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
}

function menuItems(): string[] {
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

afterEach(cleanup);
beforeEach(() => {
  meId = "dev-alice";
  fetchTripAccessMock.mockReset().mockResolvedValue({ ok: true, value: access() });
  createTripInviteMock.mockReset();
  revokeTripInviteMock.mockReset().mockResolvedValue({ ok: true, value: { ...invite, status: "revoked" } });
  setTravellingMock.mockReset();
  changeMemberRoleMock.mockReset();
  removeMemberMock.mockReset();
  leaveTripMock.mockReset();
  pushMock.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("PeopleSection", () => {
  // Mitchell, PR #269 preview: *"Need a skeleton placeholder here, so it
  // doesnt pop in magically"*. The member list used to be nothing at all until
  // the access request landed, then appeared whole.
  it("holds the list's place while it loads, and gives it up when the list lands", async () => {
    let answer: (value: unknown) => void = () => {};
    fetchTripAccessMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<PeopleSection tripId={tripId} />);

    expect(screen.getByRole("status", { name: "Loading people" })).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
    // …and the invite rows under it, which pop in with the same answer.
    // Skeletons are aria-hidden, so their test id is the handle.
    expect(screen.getByTestId("people-skeleton-invites")).toBeTruthy();

    answer({ ok: true, value: access() });
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading people" })).toBeNull();
  });

  it("drops the placeholder when the list fails to load, so it is not left breathing", async () => {
    fetchTripAccessMock.mockResolvedValue({ ok: false, error: { message: "Could not load people" } });
    render(<PeopleSection tripId={tripId} />);

    expect(await screen.findByText("Could not load people")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading people" })).toBeNull();
  });

  it("names each person by the best thing it knows and says their role in words", async () => {
    render(<PeopleSection tripId={tripId} />);
    // Identity's name wins; an email stands in when there is no name.
    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.getByText("bob@example.com")).toBeTruthy();
    // Through the row testids, not as bare strings: "Can edit" is on invite
    // rows too, so a loose assertion would pass from an invite row with no
    // member carrying it (CodeRabbit, PR #71).
    expect(screen.getByTestId("traveller-dev-alice").textContent).toContain("Owner · created the trip");
    expect(screen.getByTestId("traveller-dev-bob").textContent).toContain("Can edit");
    // No raw enum anywhere on the surface (spec §4).
    const section = screen.getByTestId("people-section").textContent ?? "";
    expect(section).not.toMatch(/\b(owner|editor|viewer|suggester)\b/);
    // …and the outstanding invite is listed by the address it was sent to.
    expect(screen.getByText("cara@example.com")).toBeTruthy();
  });

  it("marks the reader's own row, and crowns the owner's", async () => {
    render(<PeopleSection tripId={tripId} />);
    const own = await screen.findByTestId("traveller-dev-alice");
    expect(within(own).getByText("You")).toBeTruthy();
    expect(within(own).getByTestId("owner-crown")).toBeTruthy();
    const other = screen.getByTestId("traveller-dev-bob");
    expect(within(other).queryByText("You")).toBeNull();
    expect(within(other).queryByTestId("owner-crown")).toBeNull();
  });

  // The fallback is a readable HANDLE, never the raw identifier (Mitchell,
  // 2026-09-01: "Dont show the UUID"). `displayNameFor` decides it.
  it("falls back to a readable handle, not the bare user id, when Identity knows nothing", async () => {
    fetchTripAccessMock.mockResolvedValue({
      ok: true,
      value: access({
        members: [{ userId: "dev-carol", role: "owner", name: null, email: null, image: null }],
        invites: [],
      }),
    });
    render(<PeopleSection tripId={tripId} />);
    expect(await screen.findByText("Carol")).toBeTruthy();
    expect(screen.queryByText("dev-carol")).toBeNull();
  });

  it("names an opaque provider id without printing it", async () => {
    const sub = "104773518912345678901";
    fetchTripAccessMock.mockResolvedValue({
      ok: true,
      value: access({
        members: [{ userId: sub, role: "owner", name: null, email: null, image: null }],
        invites: [],
      }),
    });
    render(<PeopleSection tripId={tripId} />);
    // Six trailing digits (CodeRabbit, pull request 104) — see `lib/displayName.ts`.
    expect(await screen.findByText("Traveler 678901")).toBeTruthy();
    expect(screen.queryByText(sub)).toBeNull();
  });

  describe("groups", () => {
    it("splits members by who is travelling, and lists pending invites apart", async () => {
      fetchTripAccessMock.mockResolvedValue({
        ok: true,
        value: access({ members: [alice, { ...bob, travelling: false }] }),
      });
      render(<PeopleSection tripId={tripId} />);
      const travelling = await screen.findByRole("list", { name: "Travelling · 1" });
      expect(within(travelling).getByText("Alice")).toBeTruthy();
      const not = screen.getByRole("list", { name: "Not travelling · 1" });
      expect(within(not).getByText("bob@example.com")).toBeTruthy();
      const invited = screen.getByRole("list", { name: "Invited · 1" });
      expect(within(invited).getByText("cara@example.com")).toBeTruthy();
      expect(screen.getByText("People · 2")).toBeTruthy();
    });

    // An empty group is hidden rather than drawn as a heading over nothing.
    it("hides a group with nobody in it", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ invites: [] }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      expect(screen.queryByRole("list", { name: /^Not travelling/ })).toBeNull();
      expect(screen.queryByRole("list", { name: /^Invited/ })).toBeNull();
    });

    // Counted with `travellerIds`, so a member with no `travelling` at all —
    // a server from before the field — counts as travelling (W1).
    it("says how many travellers costs are split across", async () => {
      fetchTripAccessMock.mockResolvedValue({
        ok: true,
        value: access({
          members: [
            alice,
            { ...bob, travelling: false },
            { userId: "dev-dan", role: "suggester", name: "Dan", email: null, image: null },
          ],
        }),
      });
      render(<PeopleSection tripId={tripId} />);
      expect(await screen.findByText("Costs are split across 2 travellers.")).toBeTruthy();
    });

    it("says one traveller in the singular", async () => {
      fetchTripAccessMock.mockResolvedValue({
        ok: true,
        value: access({ members: [alice, { ...bob, travelling: false }] }),
      });
      render(<PeopleSection tripId={tripId} />);
      expect(await screen.findByText("Costs are split across 1 traveller.")).toBeTruthy();
    });

    it("describes a pending invite in words: role, whether they travel, and when it was sent", async () => {
      fetchTripAccessMock.mockResolvedValue({
        ok: true,
        value: access({
          invites: [
            { ...invite, role: "editor", travelling: true },
            { ...invite, inviteId: "2b3d5f70-1111-4222-8333-444455556666", email: null, travelling: false },
          ],
        }),
      });
      render(<PeopleSection tripId={tripId} />);
      const invited = await screen.findByRole("list", { name: "Invited · 2" });
      const [withEmail, link] = within(invited).getAllByRole("listitem");
      expect(withEmail!.textContent).toMatch(/Can edit · will travel · sent /);
      // A null email reads "Link invite", and an invite that will not travel
      // says nothing about travelling rather than "won't travel".
      expect(link!.textContent).toContain("Link invite");
      expect(link!.textContent).toMatch(/Can view · sent /);
      expect(link!.textContent).not.toContain("travel");
    });
  });

  describe("the row menu", () => {
    // Spec §4: the owner can never be removed or changed. Their menu holds
    // only the travelling toggle.
    it("offers the owner nothing on their own row but the travelling toggle", async () => {
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("Alice");
      expect(menuItems()).toEqual(["Mark as not travelling"]);
    });

    it("offers the owner the toggle, a role change and removal on someone else's row", async () => {
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      expect(menuItems()).toEqual(["Mark as not travelling", "Change role…", "Remove from trip…"]);
    });

    it("offers a member the toggle and Leave on their own row", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ myRole: "editor", invites: [] }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      expect(menuItems()).toEqual(["Mark as not travelling", "Leave trip…"]);
    });

    // D4: a member decides travelling for themselves only. Everything on
    // anyone else's row is the owner's, so there is no menu to show at all.
    it("gives a member no menu on anyone else's row", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ myRole: "editor", invites: [] }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      expect(screen.queryByRole("button", { name: "Actions for Alice" })).toBeNull();
      expect(screen.getByRole("button", { name: "Actions for bob@example.com" })).toBeTruthy();
    });

    it("marks someone not travelling, moves their row, recounts, and says the access changed", async () => {
      setTravellingMock.mockResolvedValue({
        ok: true,
        value: access({ members: [alice, { ...bob, travelling: false }] }),
      });
      const onAccessChanged = vi.fn();
      render(<PeopleSection tripId={tripId} onAccessChanged={onAccessChanged} />);
      await screen.findByText("Costs are split across 2 travellers.");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as not travelling" }));

      await waitFor(() => expect(setTravellingMock).toHaveBeenCalledWith(tripId, "dev-bob", false));
      const not = await screen.findByRole("list", { name: "Not travelling · 1" });
      expect(within(not).getByText("bob@example.com")).toBeTruthy();
      expect(screen.getByText("Costs are split across 1 traveller.")).toBeTruthy();
      // From the response, not a second read.
      expect(fetchTripAccessMock).toHaveBeenCalledTimes(1);
      expect(onAccessChanged).toHaveBeenCalledTimes(1);
    });

    it("marks someone travelling again from the Not travelling group", async () => {
      fetchTripAccessMock.mockResolvedValue({
        ok: true,
        value: access({ members: [alice, { ...bob, travelling: false }] }),
      });
      setTravellingMock.mockResolvedValue({ ok: true, value: access() });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByRole("list", { name: "Not travelling · 1" });
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as travelling" }));

      await waitFor(() => expect(setTravellingMock).toHaveBeenCalledWith(tripId, "dev-bob", true));
      expect(await screen.findByRole("list", { name: "Travelling · 2" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: /^Not travelling/ })).toBeNull();
    });

    it("reports a refused toggle and leaves the row where it was", async () => {
      setTravellingMock.mockResolvedValue({ ok: false, error: { status: 403, message: "forbidden" } });
      const onAccessChanged = vi.fn();
      render(<PeopleSection tripId={tripId} onAccessChanged={onAccessChanged} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Mark as not travelling" }));

      expect(await screen.findByText("forbidden")).toBeTruthy();
      expect(screen.getByRole("list", { name: "Travelling · 2" })).toBeTruthy();
      expect(onAccessChanged).not.toHaveBeenCalled();
    });

    it("changes a member's role in place, offering only the roles an invite can hold", async () => {
      changeMemberRoleMock.mockResolvedValue({
        ok: true,
        value: access({ members: [alice, { ...bob, role: "suggester" }] }),
      });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Change role…" }));

      const dialog = await screen.findByRole("dialog");
      const roles = within(dialog).getAllByRole("radio").map((r) => r.textContent);
      expect(roles).toEqual(["Can edit", "Can suggest", "Can view"]);
      await userEvent.click(within(dialog).getByRole("radio", { name: "Can suggest" }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

      await waitFor(() => expect(changeMemberRoleMock).toHaveBeenCalledWith(tripId, "dev-bob", "suggester"));
      await waitFor(() => expect(screen.getByTestId("traveller-dev-bob").textContent).toContain("Can suggest"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("destructive actions confirm first", () => {
    it("removes a member only after the confirm, saying what happens", async () => {
      removeMemberMock.mockResolvedValue({ ok: true, value: access({ members: [alice] }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove from trip…" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("bob@example.com loses access. Stops they were picked for keep the pick.");
      expect(removeMemberMock).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(removeMemberMock).toHaveBeenCalledWith(tripId, "dev-bob"));
      await waitFor(() => expect(screen.queryByText("bob@example.com")).toBeNull());
    });

    it("does nothing when the confirm is cancelled", async () => {
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove from trip…" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(removeMemberMock).not.toHaveBeenCalled();
      expect(screen.getByText("bob@example.com")).toBeTruthy();
    });

    it("leaves the trip after the confirm, and goes home", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ myRole: "editor", invites: [] }) });
      leaveTripMock.mockResolvedValue({ ok: true, value: { ok: true } });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Leave trip…" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("You lose access");
      expect(leaveTripMock).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole("button", { name: "Leave trip" }));

      await waitFor(() => expect(leaveTripMock).toHaveBeenCalledWith(tripId));
      expect(pushMock).toHaveBeenCalledWith("/");
    });

    it("stays put and says so when leaving is refused", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ myRole: "editor", invites: [] }) });
      leaveTripMock.mockResolvedValue({ ok: false, error: { status: 500, message: "could not leave" } });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("bob@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Leave trip…" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave trip" }));

      expect(await screen.findByText("could not leave")).toBeTruthy();
      expect(pushMock).not.toHaveBeenCalled();
    });

    it("revokes an invite only after the confirm, and re-reads the list", async () => {
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      openMenu("cara@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Revoke invite…" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog.textContent).toContain("The link stops working. If they already joined, they lose access.");
      expect(revokeTripInviteMock).not.toHaveBeenCalled();

      await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
      await waitFor(() => expect(revokeTripInviteMock).toHaveBeenCalledWith(tripId, invite.inviteId));
      expect(fetchTripAccessMock).toHaveBeenCalledTimes(2);
    });
  });

  /** Revokes the one pending invite through its menu and the confirm. */
  async function revokeThroughConfirm() {
    openMenu("cara@example.com");
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke invite…" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
  }

  describe("copying an invite's link", () => {
    it("copies an outstanding invite's link and says so on the row", async () => {
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("cara@example.com");
      openMenu("cara@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy invite link" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://test/invite/tok-123"));
      await waitFor(() => expect(within(screen.getByTestId(`invite-${invite.inviteId}`)).getByText("Copied")).toBeTruthy());
    });

    // A blocked clipboard permission is not worth a red banner — but it does
    // need a way out, so the link is shown as selectable text (CodeRabbit,
    // PR #70).
    it("reveals the link as selectable text when the clipboard is denied", async () => {
      writeText.mockRejectedValueOnce(new Error("denied"));
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("cara@example.com");
      openMenu("cara@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy invite link" }));

      const fallback = await screen.findByLabelText("Invite link");
      expect(screen.queryByText("denied")).toBeNull();
      expect((fallback as HTMLInputElement).value).toBe("http://test/invite/tok-123");
      expect(fallback.hasAttribute("readonly")).toBe(true);
      expect(within(screen.getByTestId(`invite-${invite.inviteId}`)).queryByText("Copied")).toBeNull();
    });

    it("hides the fallback again once a copy succeeds", async () => {
      writeText.mockRejectedValueOnce(new Error("denied"));
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("cara@example.com");
      openMenu("cara@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy invite link" }));
      expect(await screen.findByLabelText("Invite link")).toBeTruthy();

      openMenu("cara@example.com");
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy invite link" }));
      await waitFor(() => expect(screen.queryByLabelText("Invite link")).toBeNull());
    });
  });

  describe("errors", () => {
    // A retry that worked must not leave the previous failure sitting next to
    // fresh, correct data. Reached through two revokes, because a section
    // whose FIRST read failed renders nothing to act on.
    it("clears a previous error once a reload succeeds", async () => {
      fetchTripAccessMock
        .mockResolvedValueOnce({ ok: true, value: access() })
        .mockResolvedValueOnce({ ok: false, error: { status: 500, message: "boom" } })
        .mockResolvedValue({ ok: true, value: access() });

      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("cara@example.com");
      await revokeThroughConfirm();
      expect(await screen.findByText("boom")).toBeTruthy();

      await revokeThroughConfirm();
      await waitFor(() => expect(screen.queryByText("boom")).toBeNull());
    });

    // The reverse: `load()` clears the error on success, so a handler that set
    // its own error BEFORE reloading would wipe its own message and a failed
    // revoke would look like a success.
    it("still reports a failed revoke, even though the reload after it succeeds", async () => {
      revokeTripInviteMock.mockResolvedValue({ ok: false, error: { status: 500, message: "could not revoke" } });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("cara@example.com");
      await revokeThroughConfirm();
      expect(await screen.findByText("could not revoke")).toBeTruthy();
    });
  });

  describe("inviting", () => {
    // The invite list carries tokens, so a non-owner must not see the controls
    // at all — the server refuses them too (access/route.int.test.ts).
    it("offers no invite controls to a non-owner", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ myRole: "editor", invites: [] }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
      expect(screen.queryByRole("list", { name: /^Invited/ })).toBeNull();
    });

    it("creates an invite from the dialog, copies the link and lists it", async () => {
      fetchTripAccessMock.mockResolvedValueOnce({ ok: true, value: access({ invites: [] }) });
      createTripInviteMock.mockResolvedValue({ ok: true, value: { ...invite, token: "fresh" } });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");

      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Email (optional)"), "cara@example.com");
      await userEvent.click(within(dialog).getByRole("radio", { name: "Can view" }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));

      await waitFor(() =>
        expect(createTripInviteMock).toHaveBeenCalledWith(tripId, {
          email: "cara@example.com",
          role: "viewer",
          travelling: false,
        }),
      );
      // Copying is what actually delivers the invite — an email is a courtesy.
      expect(writeText).toHaveBeenCalledWith("http://test/invite/fresh");
      expect(await within(dialog).findByText("Emailed to cara@example.com.")).toBeTruthy();
      await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await screen.findByRole("list", { name: "Invited · 1" })).toBeTruthy();
    });

    it("surfaces a failed invite rather than looking like it worked", async () => {
      createTripInviteMock.mockResolvedValue({ ok: false, error: { status: 403, message: "forbidden" } });
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ invites: [] }) });
      const onInvitesChanged = vi.fn();
      render(<PeopleSection tripId={tripId} onInvitesChanged={onInvitesChanged} />);
      await screen.findByText("Alice");
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Create invite" }));
      expect(await screen.findByText("forbidden")).toBeTruthy();
      expect(onInvitesChanged).not.toHaveBeenCalledWith(true);
    });

    // W73: the board polls once someone can arrive, and an invite made here is
    // that moment — the board read its invites before this one existed.
    it("tells the board once an invite is made", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ invites: [] }) });
      createTripInviteMock.mockResolvedValue({ ok: true, value: invite });
      const onInvitesChanged = vi.fn();
      render(<PeopleSection tripId={tripId} onInvitesChanged={onInvitesChanged} />);
      await screen.findByText("Alice");
      expect(onInvitesChanged).toHaveBeenLastCalledWith(false);
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access() });
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Create invite" }));
      await waitFor(() => expect(onInvitesChanged).toHaveBeenCalledWith(true));
    });

    // ...and once the last one is revoked here, the board can stop (CodeRabbit
    // on #314: it polled a solo trip until it was closed).
    it("tells the board once no invite is out", async () => {
      const onInvitesChanged = vi.fn();
      render(<PeopleSection tripId={tripId} onInvitesChanged={onInvitesChanged} />);
      await screen.findByText("cara@example.com");
      expect(onInvitesChanged).toHaveBeenLastCalledWith(true);
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({ invites: [{ ...invite, status: "revoked" }] }) });
      await revokeThroughConfirm();
      await waitFor(() => expect(onInvitesChanged).toHaveBeenLastCalledWith(false));
    });
  });

  // **The collaboration gate's client half** (M20 link 6, design handoff §17.3).
  // The endpoint refuses with the tier named (`collaborationGate.int.test.ts`);
  // this is where a person reads it — before trying, rather than after. The
  // form stays on screen, disabled, under a CTA (Mitchell, 2026-09-15); since
  // the travellers spec it lives in the invite dialog, and the section itself
  // carries at most one banner (§4).
  describe("when the trip owner is not entitled to collaborators", () => {
    const solo = { members: [alice], invites: [] };
    const unentitled = (overrides: Partial<TripAccess> = {}) =>
      access({ collaboratorsEntitled: false, ...overrides });

    it("shows the invite form disabled, with the way to upgrade where Create invite was", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: unentitled(solo) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      const dialog = await screen.findByRole("dialog");
      // Every control, because a form whose button alone is disabled still
      // takes a typed address and still looks like it is going somewhere.
      // `:disabled` rather than `.disabled`: an enclosing `fieldset disabled`
      // disables its descendants without stamping the property on each.
      expect(within(dialog).getByLabelText("Email (optional)").matches(":disabled")).toBe(true);
      for (const radio of within(dialog).getAllByRole("radio")) {
        expect(radio.matches(":disabled")).toBe(true);
      }
      expect(within(dialog).getByRole("checkbox", { name: /Coming on the trip/ }).matches(":disabled")).toBe(true);
      expect(within(dialog).queryByRole("button", { name: "Create invite" })).toBeNull();
      expect(within(dialog).getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
    });

    // The gated treatment must not leak into the paying case, which is the
    // failure this whole change could plausibly introduce.
    it("leaves an entitled owner's dialog alone", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: access({}) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      await userEvent.click(screen.getByRole("button", { name: "Invite" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByLabelText("Email (optional)").matches(":disabled")).toBe(false);
      expect(within(dialog).queryByRole("link", { name: "See plans" })).toBeNull();
      expect(screen.queryByTestId("collaborators-gate")).toBeNull();
    });

    it("names the tier, says planning is free, offers the plans and shows no price", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: unentitled(solo) });
      render(<PeopleSection tripId={tripId} />);
      const block = await screen.findByTestId("collaborators-gate");
      expect(block.textContent).toContain("Premium");
      expect(block.textContent).toContain("always free");
      expect(block.textContent).not.toMatch(/\$|\bUSD\b|per month/i);
      expect(within(block).getByTestId("collaborators-gate-cta").getAttribute("href")).toBe("/plans");
    });

    // The lapse banner states the read boundary in the same words the server
    // uses — nothing removed, no role rewritten, restored by paying again.
    // **And it is the only banner** (spec §4): the gate note no longer stacks
    // under it.
    it("explains the cap when collaborators are already on the trip, as the one banner", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: unentitled() });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      const banner = screen.getByRole("status");
      expect(banner.textContent).toContain("read this trip but not edit it");
      expect(banner.textContent).toContain("Nobody was removed");
      expect(banner.textContent).toContain("restores everyone");
      expect(within(banner).getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
      expect(screen.queryByTestId("collaborators-gate")).toBeNull();
    });

    // A solo trip is not a lapse. With nobody else on it there is nothing
    // capped, so the banner would be describing a loss that did not happen.
    it("shows no lapse banner on a trip with no collaborators", async () => {
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: unentitled(solo) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByTestId("collaborators-gate");
      expect(screen.queryByRole("status")).toBeNull();
    });

    // An editor reading an unentitled owner's trip is told nothing about that
    // owner's billing. The gate and the banner are the OWNER's surfaces.
    it("says nothing to a non-owner", async () => {
      meId = "dev-bob";
      fetchTripAccessMock.mockResolvedValue({ ok: true, value: unentitled({ myRole: "editor" }) });
      render(<PeopleSection tripId={tripId} />);
      await screen.findByText("Alice");
      expect(screen.queryByTestId("collaborators-gate")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
