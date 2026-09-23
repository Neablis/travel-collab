import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const PROPOSAL = {
  proposalId: "p1",
  changes: [{ type: "AddActivity" as const, text: "Add “Coffee” to day 2" }],
  commands: [
    {
      type: "AddActivity" as const,
      tripId: "11111111-1111-4111-8111-111111111111",
      activityId: "22222222-2222-4222-8222-222222222222",
      dayId: "22222222-2222-4222-8222-222222222222",
      title: "Coffee",
    },
  ],
  inserts: [],
  skipped: [],
};

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

  // **The "different treatment" test that used to sit here is gone, and where
  // it went matters.** It asserted `question.className` contained
  // `bg-brand-tint` — two `expect(…).className` calls, each carrying a
  // grandfathered `no-restricted-syntax` disable marked *"KI-2026-09-02-b:
  // pre-existing. Do not add more."*
  //
  // §2a deletes the bubble those assertions were pinned to, so keeping them
  // meant rewriting two banned assertions rather than removing them. The
  // contract they were reaching for — the two voices are distinct, and neither
  // is a filled box — now lives in `transcriptLook.test.ts`, which reads
  // committed source and measures per-look contrast instead of poking at
  // classes on a rendered node. KI-2026-09-02-b is two disables shorter.

  // Quiet, and one line. Never the raw tool output — a trip-scoped read_trip
  // is ~1.5 KB of JSON on the wire.
  it("collapses tool calls to one line, with no JSON", () => {
    render(<Transcript turns={THREAD} />);
    expect(screen.getByRole("button", { name: /1 step · Checked day 3/ })).not.toBeNull();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).not.toContain("{");
  });

  it("reveals the full list in place, and says how to put it back", async () => {
    const user = userEvent.setup();
    render(
      <Transcript
        turns={[
          {
            id: "a1",
            role: "assistant",
            text: "Day 3 has 5 stops.",
            tools: [
              { id: "t1", label: "Read the trip" },
              { id: "t2", label: "Checked day 3" },
            ],
            pending: false,
          },
        ]}
      />,
    );
    const disclosure = screen.getByRole("button", { name: /2 steps · Checked day 3/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    // Collapsed, the earlier step is not on screen at all — "2 steps" is the
    // only trace of it, which is the point of collapsing.
    expect(screen.queryByText("Read the trip")).toBeNull();

    await user.click(disclosure);

    expect(screen.getByText("Read the trip")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hide how it got there" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Hide how it got there" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  // These lines ARE the "something is happening" during a stream — the reason
  // they exist is that a silent four-second pause reads as broken. Collapsed to
  // a snapshot they would stall again in a new way, so the summary is derived
  // on every render rather than captured when the first step landed.
  it("keeps the collapsed summary on the newest step as steps arrive", () => {
    const streaming = (tools: { id: string; label: string }[]): AssistantTurn[] => [
      { id: "a1", role: "assistant", text: "", tools, pending: true },
    ];
    const { rerender } = render(<Transcript turns={streaming([{ id: "t1", label: "Read the trip" }])} />);
    expect(screen.getByRole("button", { name: /1 step · Read the trip/ })).not.toBeNull();

    rerender(
      <Transcript
        turns={streaming([
          { id: "t1", label: "Read the trip" },
          { id: "t2", label: "Checked day 3" },
        ])}
      />,
    );
    expect(screen.getByRole("button", { name: /2 steps · Checked day 3/ })).not.toBeNull();
  });

  // SPEC §30.6 bans `scrollIntoView` repo-wide: it moves every scrollable
  // ancestor, not the intended one, and KI-2026-09-13-a is an open bug in that
  // family. Pinning belongs to whoever owns the scrollport — `usePinToBottom`.
  //
  // jsdom does not implement `scrollIntoView` at all, so there is nothing to
  // spy on — it has to be INSTALLED for its absence to be observable. That is
  // also why the deleted effect carried a `typeof … === "function"` guard, and
  // why a test written the obvious way would have passed against code that
  // still called it.
  it("does not scroll anything itself", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
    try {
      render(<Transcript turns={THREAD} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  // The slot knows nothing about what it renders: "Change" has no meaning in
  // the assistant panel, so the shared component never learns the word.
  // **Two looks, and the default must not move** (SPEC §31.1). The new-trip
  // sheet is chat-shaped because half its transcript is two- and three-word
  // answers; the desktop panel and the phone Ask sheet keep §30.5's prose. The
  // mark is the observable difference a test can hold without touching class
  // names — the wall bans `toHaveClass` and `.className` in tests, and it is
  // right to: a class assertion passes on markup nobody can see.
  //
  // §35.8 gave the chat look a speaker: Cass's face and name, **once per run**
  // of assistant turns, the way any chat lines a burst of messages up under
  // one avatar. Two runs here — the opening pair, and the answer after the
  // reader's question — so two faces and two names, not three.
  it("names Cass once per run of turns in the chat look, and leaves prose unmarked", () => {
    const runs: AssistantTurn[] = [
      { id: "a0", role: "assistant", text: "Hi, it’s Cass.", tools: [], pending: false },
      { id: "a1", role: "assistant", text: "Where are you going?", tools: [], pending: false },
      { id: "u1", role: "user", text: "Lisbon" },
      { id: "a2", role: "assistant", text: "Lisbon, good.", tools: [], pending: false },
    ];
    const { unmount } = render(<Transcript turns={runs} />);
    // Default: no mark and no name. Passing nothing is what the panel does,
    // and §35.8 says in as many words not to rename the panel's assistant.
    expect(screen.queryAllByTestId("cass-mark")).toHaveLength(0);
    expect(screen.queryByText("Cass")).toBeNull();
    unmount();

    render(<Transcript turns={runs} look="chat" />);
    const marks = screen.getAllByTestId("cass-mark");
    expect(marks).toHaveLength(2);
    // `aria-hidden`: the name beside it is text, and says it better.
    for (const mark of marks) expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByText("Cass")).toHaveLength(2);
    expect(screen.getAllByText("Trip planner")).toHaveLength(2);
    // The words are unchanged: this is a presentation change, not a content one.
    expect(screen.getByRole("log").textContent).toContain("Where are you going?");
  });

  // The typing row (§35.8, M27 D14) is the chat look's pending turn: a
  // labelled status in place of "Thinking…", saying why the dock went away.
  it("draws a pending chat turn as Cass typing, with its line if it has one", () => {
    render(
      <Transcript
        look="chat"
        turns={[
          { id: "u1", role: "user", text: "Slow" },
          { id: "typing", role: "assistant", text: "Drafting the trip…", tools: [], pending: true },
        ]}
      />,
    );
    const row = screen.getByRole("status", { name: "Cass is typing" });
    expect(row.textContent).toBe("Drafting the trip…");
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("renders a consumer's footer under each turn, and nothing when none is given", () => {
    const { rerender } = render(<Transcript turns={THREAD} />);
    expect(screen.queryByText("Change")).toBeNull();

    rerender(
      <Transcript
        turns={THREAD}
        renderTurnFooter={(turn) => (turn.role === "user" ? <span>Change {turn.id}</span> : null)}
      />,
    );
    expect(screen.getByText("Change u1")).not.toBeNull();
    expect(screen.getByText("Change u2")).not.toBeNull();
  });

  // A conversation that silently pauses reads as broken.
  it("shows a pending turn as thinking until any text or tool call arrives", () => {
    render(<Transcript turns={THREAD} />);
    expect(within(screen.getByRole("log")).getByText("Thinking…")).not.toBeNull();
  });

  it("keeps the streamed text visible once it starts, without a second visible status line", () => {
    render(
      <Transcript
        turns={[{ id: "a1", role: "assistant", text: "Day 3 ha", tools: [], pending: true }]}
      />,
    );
    expect(screen.getByText("Day 3 ha")).not.toBeNull();
    // The visible progress line drops away: the arriving text is the indicator.
    expect(within(screen.getByRole("log")).queryByText(/Still writing…|Thinking…/)).toBeNull();
  });

  it("renders nothing but the log when the thread is empty", () => {
    render(<Transcript turns={[]} />);
    expect(screen.getByRole("log").textContent).toBe("");
  });
});

// Finding 4 of the final branch review, rated ABOVE where it was first filed:
// `role="log" aria-live="polite"` around text that mutates per streamed delta,
// with a nested `role="status"` among the turns, makes a screen reader
// re-announce the whole growing answer on every token. That is worse than no
// live region at all. What replaces it announces turn boundaries and completion.
describe("Transcript — what a screen reader is told", () => {
  const announcer = () => screen.getByRole("status").textContent;

  it("does not make the transcript itself a live region", () => {
    render(<Transcript turns={THREAD} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    // Explicit, because role="log" is implicitly polite — absent is not off.
    expect(log.getAttribute("aria-live")).toBe("off");
    // …and exactly one region that does announce, outside the log.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(within(log).queryAllByRole("status")).toHaveLength(0);
  });

  it("announces the boundary of a turn that has not started arriving", () => {
    render(<Transcript turns={[{ id: "a1", role: "assistant", text: "", tools: [], pending: true }]} />);
    expect(announcer()).toBe("Thinking…");
  });

  // The one that matters. Two renders, two very different amounts of text, one
  // unchanged announcement — which is what stops the re-announce-per-token.
  it("says the same thing however much of the answer has streamed", () => {
    const partial = (text: string): AssistantTurn[] => [
      { id: "a1", role: "assistant", text, tools: [{ id: "t1", label: "Read the trip" }], pending: true },
    ];
    const { rerender } = render(<Transcript turns={partial("Kyoto")} />);
    const early = announcer();
    rerender(<Transcript turns={partial("Kyoto runs to 3 days, starting 2027-04-01. There are 6 stops.")} />);
    expect(announcer()).toBe(early);
    expect(early).toBe("Writing the answer…");
  });

  it("announces the finished answer once, when it is finished", () => {
    render(
      <Transcript turns={[{ id: "a1", role: "assistant", text: "Kyoto runs to 3 days.", tools: [], pending: false }]} />,
    );
    expect(announcer()).toBe("Answer: Kyoto runs to 3 days.");
  });

  it("says a proposal is waiting, because the card below is the next thing to do", () => {
    render(
      <Transcript
        turns={[
          {
            id: "a1",
            role: "assistant",
            text: "I've drafted 2 changes.",
            tools: [],
            pending: false,
            proposal: { proposal: PROPOSAL, status: "pending", note: null },
          },
        ]}
      />,
    );
    expect(announcer()).toContain("A proposed change is waiting for your review below.");
  });

  it("says nothing at all about an empty thread", () => {
    render(<Transcript turns={[]} />);
    expect(announcer()).toBe("");
  });
});

describe("toolNoteLabel", () => {
  it.each([
    ["read_trip", {}, "Read the trip"],
    ["read_day", { days: 3 }, "Checked day 3"],
    ["read_day", { days: [8, 9, 10] }, "Checked days 8, 9, 10"],
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
