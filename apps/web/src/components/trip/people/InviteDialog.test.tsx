import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tripInviteFactory } from "@tc/factories";

const createTripInviteMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  createTripInvite: (...args: unknown[]) => createTripInviteMock(...args),
  inviteLink: (token: string) => `http://test/invite/${token}`,
}));

import { InviteDialog } from "./InviteDialog";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const invite = tripInviteFactory.build({ tripId, token: "tok-new" });

const writeText = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof InviteDialog>> = {}) {
  const onCreated = vi.fn();
  render(<InviteDialog tripId={tripId} open onOpenChange={() => {}} gated={false} onCreated={onCreated} {...props} />);
  return { dialog: screen.getByRole("dialog"), onCreated };
}

function comingOnTheTrip(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByRole("checkbox", { name: /Coming on the trip/ }) as HTMLInputElement;
}

afterEach(cleanup);
beforeEach(() => {
  createTripInviteMock.mockReset().mockResolvedValue({ ok: true, value: invite });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("InviteDialog", () => {
  // Spec 2026-10-03 §2.1: the suggester sits between the two it is between,
  // and the owner still starts on "Can edit".
  it("offers Can suggest between edit and view, starting on Can edit, and says what each means", async () => {
    const { dialog } = renderDialog();
    const roles = within(dialog).getAllByRole("radio");
    expect(roles.map((r) => r.textContent)).toEqual(["Can edit", "Can suggest", "Can view"]);
    expect(within(dialog).getByRole("radio", { name: "Can edit" }).getAttribute("aria-checked")).toBe("true");
    const meaning = within(dialog).getByTestId("role-meaning");
    const editMeaning = meaning.textContent;

    await userEvent.click(within(dialog).getByRole("radio", { name: "Can suggest" }));
    expect(meaning.textContent).not.toBe(editMeaning);
    expect(meaning.textContent).toContain("approve");
  });

  // D3: Can edit → travelling; Can suggest and Can view → not. #314's case is
  // the suggester who joined to advise and doubled every per-person total.
  it("presets Coming on the trip from the role", async () => {
    const { dialog } = renderDialog();
    expect(comingOnTheTrip(dialog).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can suggest" }));
    expect(comingOnTheTrip(dialog).checked).toBe(false);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can view" }));
    expect(comingOnTheTrip(dialog).checked).toBe(false);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can edit" }));
    expect(comingOnTheTrip(dialog).checked).toBe(true);
  });

  it("sends the preset, so the server is told rather than left to guess", async () => {
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can suggest" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));
    await waitFor(() =>
      expect(createTripInviteMock).toHaveBeenCalledWith(tripId, { email: null, role: "suggester", travelling: false }),
    );
  });

  // "The owner can flip it before sending" (D3).
  it("sends the owner's own choice when they flip the preset", async () => {
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can suggest" }));
    await userEvent.click(comingOnTheTrip(dialog));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));
    await waitFor(() =>
      expect(createTripInviteMock).toHaveBeenCalledWith(tripId, { email: null, role: "suggester", travelling: true }),
    );
  });

  it("sends null, not an empty string, when no email is typed", async () => {
    const { dialog } = renderDialog();
    await userEvent.type(within(dialog).getByLabelText("Email (optional)"), "   ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));
    await waitFor(() =>
      expect(createTripInviteMock).toHaveBeenCalledWith(tripId, { email: null, role: "editor", travelling: true }),
    );
  });

  it("shows the new link with a Copy, copies it straight away, and hands the invite back", async () => {
    const { dialog, onCreated } = renderDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));

    const link = (await within(dialog).findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe("http://test/invite/tok-new");
    expect(writeText).toHaveBeenCalledWith("http://test/invite/tok-new");
    expect(onCreated).toHaveBeenCalledWith(invite);
    // No address, so no claim that anything was emailed.
    expect(within(dialog).queryByText(/Emailed to/)).toBeNull();

    // The visible label flips; the accessible name does not, so the button is
    // one locator whichever state it is in.
    const copy = within(dialog).getByRole("button", { name: "Copy invite link" });
    expect(copy.textContent).toBe("Copied");
    writeText.mockClear();
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("http://test/invite/tok-new");
  });

  // The link is on screen as selectable text in the success state anyway, so
  // a denied clipboard only needs saying — not a red banner (CodeRabbit, PR #70).
  it("says the clipboard was out of reach and leaves the link to copy by hand", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));
    expect(await within(dialog).findByText(/Couldn.t reach your clipboard/)).toBeTruthy();
    expect(within(dialog).queryByText("denied")).toBeNull();
    expect(((await within(dialog).findByLabelText("Invite link")) as HTMLInputElement).readOnly).toBe(true);
  });

  // The same instance closed and reopened, as the section does: a second
  // invite must not inherit the first one's address, role or link.
  it("starts empty again when it is opened for the next invite", async () => {
    const props = { tripId, onOpenChange: () => {}, gated: false, onCreated: () => {} };
    const { rerender } = render(<InviteDialog {...props} open />);
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Email (optional)"), "a@example.com");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Can view" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create invite" }));
    await within(dialog).findByLabelText("Invite link");

    rerender(<InviteDialog {...props} open={false} />);
    rerender(<InviteDialog {...props} open />);
    const again = screen.getByRole("dialog");
    expect(within(again).queryByLabelText("Invite link")).toBeNull();
    expect((within(again).getByLabelText("Email (optional)") as HTMLInputElement).value).toBe("");
    expect(within(again).getByRole("radio", { name: "Can edit" }).getAttribute("aria-checked")).toBe("true");
  });
});
