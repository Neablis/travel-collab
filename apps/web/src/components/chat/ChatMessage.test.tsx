import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessage as ChatMessageData, type SuggestionChange, type TripRole } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import type { Persona } from "@/components/pages/people";
import { ChatMessage, FORMER_MEMBER, type MessageViewer } from "./ChatMessage";

// Who is reading, and the trip's pending suggestions as the board holds them:
// what an assistant reply's card is decided from (M52 decision 18).
const reader = vi.hoisted(() => ({ me: undefined as { id: string } | undefined, trip: null as unknown }));
vi.mock("@/components/account/useSessionUser", () => ({ useKnownSessionUser: () => reader.me }));
vi.mock("@/components/trip/context/TripProvider", () => ({ useOptionalTrip: () => reader.trip }));
afterEach(() => {
  reader.me = undefined;
  reader.trip = null;
});

const TRIP = uuidFrom(46);
const beas = ChatMessageData.parse({
  messageId: uuidFrom(1, 46),
  authorId: "u-bea",
  createdAt: "2026-10-13T10:00:00.000Z",
  editedAt: null,
  removed: false,
  body: "Train at nine?",
});
const bea = { name: "Bea", avatar: null, color: null, colorShifted: false, travelling: true };

function line(viewer: MessageViewer | null, message: ChatMessageData = beas, pending = false, askedBy: Persona | null | undefined = bea) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <ol>
      <ChatMessage
        message={message}
        persona={bea}
        tripId={TRIP}
        viewer={viewer}
        editing={false}
        onEdit={onEdit}
        onDelete={onDelete}
        onSave={async () => true}
        onCancelEdit={() => {}}
        pending={pending}
        askedBy={askedBy}
      />
    </ol>,
  );
  return { onEdit, onDelete };
}

const actions = () => screen.queryByRole("button", { name: "Actions for Bea's message" });
const items = async () => {
  await userEvent.click(actions()!);
  return (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
};

// M46 D6: an author edits and deletes their own, the owner deletes anyone's,
// and everyone else may only report it. The server refuses the rest; these
// are what the line offers, so nobody is handed a control that answers 403.
describe("ChatMessage's actions", () => {
  it("offers another member's message for report, and no way to change it", () => {
    line({ mine: false, mayEdit: false, mayDelete: false });
    expect(actions()).toBeNull();
    expect(screen.getByRole("button", { name: "Report Bea's message" })).toBeTruthy();
  });

  // Mitchell's M46 walk: Report was a word-sized button on every line. It is
  // a flag now, named for screen readers since it has no words of its own,
  // and the name says whose: a chat is a list of these.
  it("reports another member's message from a flag with no words, which opens the report dialog", async () => {
    line({ mine: false, mayEdit: false, mayDelete: false });
    const flag = screen.getByRole("button", { name: "Report Bea's message" });
    expect(flag.textContent).toBe("");
    expect(flag.innerHTML).toContain("<svg");
    await userEvent.click(flag);
    expect(await screen.findByRole("dialog", { name: "Report Bea's message" })).toBeTruthy();
  });

  it("offers the author Edit and Delete on their own, and no Report", async () => {
    const { onEdit } = line({ mine: true, mayEdit: true, mayDelete: true });
    expect(screen.queryByRole("button", { name: "Report Bea's message" })).toBeNull();
    expect(await items()).toEqual(["Edit", "Delete"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("offers the owner Delete on someone else's, beside Report", async () => {
    const { onDelete } = line({ mine: false, mayEdit: false, mayDelete: true });
    expect(screen.getByRole("button", { name: "Report Bea's message" })).toBeTruthy();
    expect(await items()).toEqual(["Delete"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("offers nothing on a removed message", () => {
    const { messageId, authorId, createdAt } = beas;
    line({ mine: true, mayEdit: true, mayDelete: true }, ChatMessageData.parse({ messageId, authorId, createdAt, editedAt: null, removed: true }));
    expect(actions()).toBeNull();
    expect(screen.getByText("message removed")).toBeTruthy();
  });

  it("offers nothing before the reader is known, and says a message was edited", () => {
    line(null, { ...beas, editedAt: "2026-10-13T10:05:00.000Z" });
    expect(actions()).toBeNull();
    expect(screen.queryByRole("button", { name: "Report Bea's message" })).toBeNull();
    expect(screen.getByRole("listitem").textContent).toContain("edited");
  });
});

// PR 444 review: a pending line was only dimmed, which fell below AA contrast
// and said nothing to a screen reader. It says "Sending…" where its time goes.
describe("ChatMessage, sent and not yet stored", () => {
  it("says Sending… in place of its time, and is busy", () => {
    const sentAt = new Date(beas.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    line(null, beas, true);
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("Sending…");
    expect(item.textContent).not.toContain(sentAt);
    expect(item.getAttribute("aria-busy")).toBe("true");
  });
});

// M52 decisions 17 and 18: the assistant's replies and the app's change lines
// are in the thread too, and neither is a member's to change.
describe("ChatMessage, from the assistant or the app", () => {
  const SUGGESTION = uuidFrom(9, 46);
  const reply = ChatMessageData.parse({
    messageId: uuidFrom(2, 46),
    authorId: "assistant",
    kind: "assistant",
    requestedBy: "u-bea",
    replyTo: beas.messageId,
    suggestionId: SUGGESTION,
    createdAt: "2026-10-13T10:01:00.000Z",
    editedAt: null,
    removed: false,
    body: "I can push dinner back an hour.",
  });
  const change = (n: number, dependsOn: string[] = []): SuggestionChange => ({
    id: uuidFrom(20 + n, 46),
    suggestionId: SUGGESTION,
    tripId: TRIP,
    authorId: "u-bea",
    note: null,
    createdAt: "2026-10-13T10:01:00.000Z",
    commands: [{ type: "SetTripName", tripId: TRIP, name: "Lisbon" }],
    description: `Change ${n}`,
    status: "pending",
    dependsOn,
    resolvedBy: null,
    resolvedAt: null,
    via: "assistant",
    requestedBy: "u-bea",
  });
  const changes = [change(1), change(2, [uuidFrom(21, 46)])];
  function readAs(id: string, myRole: TripRole) {
    const suggestions = { changes, acceptMany: vi.fn(async () => ({ ok: true, value: [] })), resolve: vi.fn(async () => ({ ok: true, value: [] })) };
    reader.me = { id };
    reader.trip = { myRole, suggestions };
    return suggestions;
  }
  const card = () => screen.getByRole("group", { name: "The assistant's suggestion" });

  it("names the assistant as the author of its reply", () => {
    line({ mine: false, mayEdit: false, mayDelete: false }, { ...reply, suggestionId: null }, false, undefined);
    expect(screen.getByRole("listitem").textContent).toContain("Assistant");
    expect(screen.getByRole("listitem").textContent).not.toContain(FORMER_MEMBER);
  });

  it("offers the asker Accept and Dismiss, taking the whole suggestion as one", async () => {
    const suggestions = readAs("u-bea", "editor");
    line({ mine: false, mayEdit: false, mayDelete: false }, reply);
    await userEvent.click(within(card()).getByRole("button", { name: "Accept" }));
    expect(suggestions.acceptMany).toHaveBeenCalledWith(changes.map((c) => c.id));
    await userEvent.click(within(card()).getByRole("button", { name: "Dismiss" }));
    // The first change: dismissing it takes the one built on it along.
    expect(suggestions.resolve).toHaveBeenCalledExactlyOnceWith(changes[0]!.id, "dismiss");
  });

  it("tells another editor who it waits on, and offers them nothing", () => {
    readAs("u-cal", "editor");
    line({ mine: false, mayEdit: false, mayDelete: false }, reply);
    expect(card().textContent).toContain("Waiting on Bea");
    expect(within(card()).queryAllByRole("button")).toEqual([]);
  });

  it("lets the trip's owner dismiss it, never accept it", () => {
    readAs("u-owner", "owner");
    line({ mine: false, mayEdit: false, mayDelete: true }, reply);
    expect(card().textContent).toContain("Waiting on Bea");
    expect(within(card()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Dismiss"]);
  });

  it("draws a change line with no way to change, delete or report it", () => {
    const changed = ChatMessageData.parse({ ...beas, messageId: uuidFrom(3, 46), kind: "system", body: "Bea moved “Dinner at Tasca” to 20:30" });
    line({ mine: true, mayEdit: true, mayDelete: true }, changed);
    expect(screen.getByRole("listitem").textContent).toContain("Bea moved “Dinner at Tasca” to 20:30");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});
