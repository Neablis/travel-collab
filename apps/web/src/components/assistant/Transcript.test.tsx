import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Transcript, toolNoteLabel, type AssistantTurn } from "./Transcript";

afterEach(cleanup);

const THREAD: AssistantTurn[] = [
  { id: "u1", role: "user", text: "What's planned for day 3?" },
  {
    id: "a1",
    role: "assistant",
    text: "Day 3 has 5 stops.",
    tools: [{ id: "t1", label: "Checked day 3" }],
    pending: false,
  },
  { id: "u2", role: "user", text: "What about the next day?" },
  { id: "a2", role: "assistant", text: "", tools: [], pending: true },
];

describe("Transcript", () => {
  it("renders both sides of the conversation, in order", () => {
    render(<Transcript turns={THREAD} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("What's planned for day 3?");
    expect(log.textContent).toContain("Day 3 has 5 stops.");
    expect(log.textContent!.indexOf("What's planned for day 3?")).toBeLessThan(
      log.textContent!.indexOf("Day 3 has 5 stops."),
    );
  });

  // Visibly distinct from one another, and asserted on the rendered treatment
  // rather than on a test id, because "distinct" is the requirement.
  it("gives a user turn a different treatment from an assistant turn", () => {
    render(<Transcript turns={THREAD} />);
    const question = screen.getByText("What's planned for day 3?");
    const answer = screen.getByText("Day 3 has 5 stops.");
    expect(question.className).toContain("bg-brand-tint");
    expect(answer.className).not.toContain("bg-brand-tint");
  });

  // Quiet, and one line. Never the raw tool output — a trip-scoped read_trip
  // is ~1.5 KB of JSON on the wire.
  it("shows tool calls as one-line notes, with no JSON", () => {
    render(<Transcript turns={THREAD} />);
    expect(screen.getByText("Checked day 3")).not.toBeNull();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).not.toContain("{");
  });

  // A conversation that silently pauses reads as broken.
  it("shows a pending turn as thinking until any text or tool call arrives", () => {
    render(<Transcript turns={THREAD} />);
    expect(within(screen.getByRole("log")).getByRole("status").textContent).toBe("Thinking…");
  });

  it("keeps the streamed text visible once it starts, without a second visible status line", () => {
    render(
      <Transcript
        turns={[{ id: "a1", role: "assistant", text: "Day 3 ha", tools: [], pending: true }]}
      />,
    );
    expect(screen.getByText("Day 3 ha")).not.toBeNull();
    expect(screen.getByRole("status").className).toContain("sr-only");
  });

  it("renders nothing but the log when the thread is empty", () => {
    render(<Transcript turns={[]} />);
    expect(screen.getByRole("log").textContent).toBe("");
  });
});

describe("toolNoteLabel", () => {
  it.each([
    ["read_trip", {}, "Read the trip"],
    ["read_day", { day: 3 }, "Checked day 3"],
    ["read_day", {}, "Checked the day you're looking at"],
    ["find_free_time", { day: 2, after: "08:00" }, "Looked for free time on day 2"],
    ["find_free_time", { after: "08:00" }, "Looked for free time"],
  ])("says %s(%j) as a sentence", (toolName, input, expected) => {
    expect(toolNoteLabel(toolName, input)).toBe(expected);
  });

  // The write tools (M9) are the derived planning tools, so their names are
  // the BatchableCommand type literals — PascalCase, where every read tool is
  // snake_case. A thirteenth command therefore reads correctly here with no
  // second manifest to update; the change ITSELF is on the proposal card.
  it.each(["AddActivity", "MoveActivity", "SetTripDates", "DismissConflict"])(
    "says %s as a drafted change, not as a raw tool name",
    (toolName) => {
      expect(toolNoteLabel(toolName, { title: "Coffee" })).toBe("Drafted a change");
    },
  );

  // An unknown READ tool still gets a civil sentence, not a blank line and not
  // `undefined`.
  it("still says something for a snake_case tool this build has never heard of", () => {
    expect(toolNoteLabel("propose_batch", null)).toBe("Used propose batch");
  });

  it("tolerates a non-object input", () => {
    expect(toolNoteLabel("read_day", "nonsense")).toBe("Checked the day you're looking at");
  });
});

// M9's propose -> review -> approve, from the transcript's side: the card
// belongs to the answer that produced it, and the callbacks are keyed by that
// answer's turn id — so a second proposal later in the thread cannot be
// approved by clicking the first.
describe("Transcript proposals", () => {
  const PROPOSAL = {
    proposalId: "p1",
    changes: [{ type: "AddActivity", text: "Add “Coffee” to day 2" }],
    commands: [
      {
        type: "AddActivity" as const,
        tripId: "11111111-1111-4111-8111-111111111111",
        activityId: "22222222-2222-4222-8222-222222222222",
        dayId: "22222222-2222-4222-8222-222222222222",
        title: "Coffee",
      },
    ],
    skipped: [],
  };

  const threadWithTwo: AssistantTurn[] = [
    { id: "u1", role: "user", text: "add a coffee stop" },
    {
      id: "a1",
      role: "assistant",
      text: "I've drafted 1 change.",
      tools: [],
      pending: false,
      proposal: { proposal: PROPOSAL, status: "applied", note: "Done — added “Coffee” to day 2." },
    },
    { id: "u2", role: "user", text: "and another" },
    {
      id: "a2",
      role: "assistant",
      text: "I've drafted 1 change.",
      tools: [],
      pending: false,
      proposal: { proposal: PROPOSAL, status: "pending", note: null },
    },
  ];

  it("renders no card on an answer that proposed nothing", () => {
    render(<Transcript turns={THREAD} />);
    expect(screen.queryByRole("region", { name: "Proposed change" })).toBeNull();
  });

  it("renders one card per proposing answer, under its prose", () => {
    render(<Transcript turns={threadWithTwo} />);
    expect(screen.getAllByLabelText("Proposed change")).toHaveLength(2);
  });

  it("approves the turn the card belongs to, not the first one in the thread", () => {
    const onApproveProposal = vi.fn();
    render(<Transcript turns={threadWithTwo} onApproveProposal={onApproveProposal} onRejectProposal={vi.fn()} />);
    // Only the pending one offers Approve — the applied one is done.
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApproveProposal).toHaveBeenCalledWith("a2");
  });

  it("rejects the turn the card belongs to", () => {
    const onRejectProposal = vi.fn();
    render(<Transcript turns={threadWithTwo} onApproveProposal={vi.fn()} onRejectProposal={onRejectProposal} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onRejectProposal).toHaveBeenCalledWith("a2");
  });

  it("passes one blocked reason to every card — it is a fact about the board", () => {
    render(
      <Transcript
        turns={threadWithTwo}
        onApproveProposal={vi.fn()}
        onRejectProposal={vi.fn()}
        approvalBlockedReason="You have view-only access to this trip."
      />,
    );
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
