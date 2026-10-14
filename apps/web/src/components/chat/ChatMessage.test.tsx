import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatMessage as ChatMessageData } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { ChatMessage, type MessageViewer } from "./ChatMessage";

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

function line(viewer: MessageViewer | null, message: ChatMessageData = beas, pending = false) {
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
