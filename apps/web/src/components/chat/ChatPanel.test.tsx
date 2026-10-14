import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { TripRole } from "@tc/contracts";
import { ChatMessage } from "@tc/contracts";
import { tripDetailFixture, tripMemberProfileFactory, uuidFrom } from "@tc/factories";
import { personasOf } from "@/components/pages/people";
import { tripTargets } from "@/components/palette/commands";
import { registerBoardFocus } from "./boardFocus";
import { FORMER_MEMBER } from "./ChatMessage";
import { ChatPanel, NO_ACCESS_LINE, READ_ONLY_LINE } from "./ChatPanel";
import type { TripChat } from "./useTripChat";

// Who is reading, and their role on the trip: what the line's actions are
// decided from (M46 D6).
let me: { id: string } | undefined;
let myRole: TripRole | null = null;
vi.mock("@/components/account/useSessionUser", () => ({ useKnownSessionUser: () => me }));
vi.mock("@/components/trip/context/TripProvider", () => ({ useOptionalTrip: () => ({ myRole }) }));
beforeEach(() => {
  me = undefined;
  myRole = null;
});

const chat = (over: Partial<TripChat> = {}): TripChat => ({
  tripId: uuidFrom(46),
  status: "ready",
  messages: [
    ChatMessage.parse({
      messageId: uuidFrom(1, 46),
      authorId: "u-bea",
      createdAt: "2026-10-13T10:00:00.000Z",
      editedAt: null,
      removed: false,
      body: "Train at nine?",
    }),
  ],
  hasEarlier: false,
  unread: 0,
  canPost: true,
  post: async () => null,
  postError: null,
  edit: async () => true,
  remove: async () => true,
  changeError: null,
  ...over,
});

const bea = personasOf([tripMemberProfileFactory.build({ userId: "u-bea", displayName: "Bea" })]);

describe("ChatPanel", () => {
  it("offers a composer to a member who may post", () => {
    render(<ChatPanel chat={chat()} personas={null} />);
    expect(screen.getByRole("combobox", { name: "Message" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // M46 D2: after the owner's lapse the conversation stays readable, and the
  // composer says why instead of being there.
  it("is read-only after a lapse: the messages stay, the composer is a line saying why", () => {
    render(<ChatPanel chat={chat({ canPost: false })} personas={null} />);
    expect(within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Message" })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(READ_ONLY_LINE);
  });

  // M46 D2: a 403 says so, with a way out, instead of looking live.
  it("says the reader no longer has access, with a link home, and shows no conversation", () => {
    render(<ChatPanel chat={chat({ status: "no-access" })} personas={null} />);
    expect(screen.getByRole("status").textContent).toContain(NO_ACCESS_LINE);
    expect(screen.getByRole("link", { name: "Back to your trips" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("list", { name: "Messages" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Message" })).toBeNull();
  });

  // An author is named from the members; one no longer among them keeps
  // their words under a neutral name, and before the members are known
  // nobody is called a former member.
  it("names authors from the members, a missing one as a former member, and nobody before the members load", () => {
    const bea = tripMemberProfileFactory.build({ userId: "u-bea", displayName: "Bea" });
    const removed = { ...chat().messages[0]!, messageId: uuidFrom(2, 46), authorId: "u-gone", removed: true, body: "" };
    const { rerender } = render(<ChatPanel chat={chat({ messages: [...chat().messages, removed] })} personas={null} />);
    const lines = () => within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem");
    expect(lines().map((line) => line.textContent)).not.toContainEqual(expect.stringContaining(FORMER_MEMBER));

    rerender(<ChatPanel chat={chat({ messages: [...chat().messages, removed] })} personas={personasOf([bea])} />);
    expect(lines()[0]!.textContent).toContain("Bea");
    expect(lines()[1]!.textContent).toContain(FORMER_MEMBER);
    expect(lines()[1]!.textContent).toContain("message removed");
  });

  // M46 D6: the author edits in place, and the new text is what is sent.
  it("edits the author's own line in place", async () => {
    me = { id: "u-bea" };
    const edit = vi.fn(async () => true);
    render(<ChatPanel chat={chat({ edit })} personas={bea} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Bea's message" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const field = screen.getByRole("textbox", { name: "Edit message" });
    await userEvent.clear(field);
    await userEvent.type(field, "Train at ten?");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(edit).toHaveBeenCalledWith(uuidFrom(1, 46), "Train at ten?");
    expect(screen.queryByRole("textbox", { name: "Edit message" })).toBeNull();
  });

  // A delete is shown to everyone on the trip, so it asks first.
  it("lets the owner delete someone else's line, only once they confirm", async () => {
    me = { id: "u-owner" };
    myRole = "owner";
    const remove = vi.fn(async () => true);
    render(<ChatPanel chat={chat({ remove })} personas={bea} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Bea's message" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const confirm = screen.getByRole("dialog", { name: "Delete this message?" });
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith(uuidFrom(1, 46));
  });

  // PR 440 review, finding 4. Save, Cancel and a confirmed Delete each unmount
  // the control focus was on; the line keeps it, so the next Tab starts there
  // and not at the top of the page. `:focus` asked of the element a query
  // found, as SnapshotList.test.tsx does: the wall bans `activeElement`.
  describe("focus", () => {
    const line = () => within(screen.getByRole("list", { name: "Messages" })).getAllByRole("listitem")[0]!;
    const hasFocus = (element: HTMLElement) => element.matches(":focus");
    const openEdit = async () => {
      await userEvent.click(screen.getByRole("button", { name: "Actions for Bea's message" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    };

    it("stays on the line after an edit is saved or cancelled", async () => {
      me = { id: "u-bea" };
      render(<ChatPanel chat={chat()} personas={bea} />);
      await openEdit();
      await userEvent.type(screen.getByRole("textbox", { name: "Edit message" }), "!{Enter}");
      await vi.waitFor(() => expect(hasFocus(line())).toBe(true));

      await openEdit();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(hasFocus(line())).toBe(true);
    });

    it("stays on the line once a delete is confirmed", async () => {
      me = { id: "u-bea" };
      render(<ChatPanel chat={chat()} personas={bea} />);
      await userEvent.click(screen.getByRole("button", { name: "Actions for Bea's message" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
      await userEvent.click(within(screen.getByRole("dialog", { name: "Delete this message?" })).getByRole("button", { name: "Delete" }));
      await vi.waitFor(() => expect(hasFocus(line())).toBe(true));
    });
  });

  // Mitchell's M46 walk: the message shows the moment Send is pressed, so the
  // composer empties then, not when the server answers; a send that was not
  // stored gives the words back.
  it("empties the composer at once, and gives the text back when the send was not stored", async () => {
    let answered: (unsent: string | null) => void = () => {};
    const post = vi.fn(() => new Promise<string | null>((resolve) => (answered = resolve)));
    render(<ChatPanel chat={chat({ post })} personas={null} />);
    const field = screen.getByRole("combobox", { name: "Message" }) as HTMLInputElement;
    await userEvent.type(field, "Train at nine?{Enter}");
    expect(post).toHaveBeenCalledWith("Train at nine?", undefined);
    expect(field.value).toBe("");

    answered("Train at nine?");
    await vi.waitFor(() => expect(field.value).toBe("Train at nine?"));
  });

  // PR 444 review, finding 1: the text came back without its @day link, so
  // the retry was stored as plain words, with no chip and no jump.
  it("gives a failed send's @day link back with its text, so the retry carries it", async () => {
    const day = uuidFrom(3, 46);
    const trip = tripDetailFixture({ days: [{ dayId: day, activityIds: [], date: null, costSubtotal: 0 }] });
    act(() => {
      const unregister = registerBoardFocus({ ...tripTargets(trip, { focusedActivityId: null, focusedDayId: null, selectedDayId: null }), focusDay: vi.fn(), focusActivity: vi.fn() });
      onTestFinished(() => act(() => unregister()));
    });
    const post = vi.fn(async (body: string): Promise<string | null> => (post.mock.calls.length === 1 ? body : null));
    render(<ChatPanel chat={chat({ post })} personas={null} />);
    const field = screen.getByRole("combobox", { name: "Message" }) as HTMLInputElement;
    await userEvent.type(field, "@day 1{Enter}dinner here?{Enter}");
    expect(post).toHaveBeenLastCalledWith("@Day 1 dinner here?", { kind: "day", id: day });
    await vi.waitFor(() => expect(field.value).toBe("@Day 1 dinner here?"));

    await userEvent.type(field, "{Enter}");
    expect(post).toHaveBeenLastCalledWith("@Day 1 dinner here?", { kind: "day", id: day });
  });

  // PR 444 review, finding 3: what the reader has started since is theirs;
  // the failed text does not overwrite it, and the alert says it was not sent.
  it("keeps what the reader has typed since when the send fails", async () => {
    let answered: (unsent: string | null) => void = () => {};
    const post = vi.fn(() => new Promise<string | null>((resolve) => (answered = resolve)));
    const { rerender } = render(<ChatPanel chat={chat({ post })} personas={null} />);
    const field = screen.getByRole("combobox", { name: "Message" }) as HTMLInputElement;
    await userEvent.type(field, "Train at nine?{Enter}x");

    await act(async () => answered("Train at nine?"));
    rerender(<ChatPanel chat={chat({ post, postError: "Couldn't send. Check your connection and try again." })} personas={null} />);
    expect(field.value).toBe("x");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't send");
  });

  it("offers nothing on the reader's own line until it is stored", () => {
    me = { id: "u-bea" };
    myRole = "owner";
    render(<ChatPanel chat={chat({ messages: [{ ...chat().messages[0]!, pending: true }] })} personas={bea} />);
    expect(screen.getByRole("listitem").textContent).toContain("Train at nine?");
    expect(screen.getByRole("listitem").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Actions for Bea's message" })).toBeNull();
  });

  it("gives an editor no way to change someone else's line", () => {
    me = { id: "u-cal" };
    myRole = "editor";
    render(<ChatPanel chat={chat()} personas={bea} />);
    expect(screen.queryByRole("button", { name: "Actions for Bea's message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report Bea's message" })).toBeTruthy();
  });
});
