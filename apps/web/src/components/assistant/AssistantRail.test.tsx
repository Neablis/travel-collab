import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantRail } from "./AssistantRail";
import type { AssistantTurn } from "./Transcript";

afterEach(cleanup);


// Required-prop fixture for tests that assert on a specific optional prop
// (e.g. `simulated`) without needing renderRail's override merging — mirrors
// the same values renderRail defaults to below.
const baseProps: React.ComponentProps<typeof AssistantRail> = {
  contextLine: "Looking at Day 2 · Kyoto",
  scope: { kind: "day", dayIndex: 1 },
  turns: [],
  suggestions: [],
  asksRemaining: 20,
  onAsk: vi.fn(),
  onApproveProposal: vi.fn(),
  onRejectProposal: vi.fn(),
  onNewConversation: vi.fn(),
  onHide: vi.fn(),
};

function renderRail(overrides: Partial<React.ComponentProps<typeof AssistantRail>> = {}) {
  return render(<AssistantRail {...baseProps} onAsk={vi.fn()} onHide={vi.fn()} {...overrides} />);
}

// M16 Wave 1 (Task 4, SPEC §9 docked presentation): the rail is a flex
// sibling of the plan now, not a `position: fixed` overlay with a scrim in
// front of it (KI-16, KI-17) — there is no scrim left to test.
//
// M16 Wave 2 (Task 5): the chip row is back, but as `suggestions` — derived
// from real trip state by suggestedQuestions.ts, which has its own suite for
// the rules. What this file asserts about them is only what the rail owns:
// that they are offered while the thread is empty, that clicking one asks it,
// and that they get out of the way once a conversation is running.
describe("AssistantRail", () => {
  it("renders the context line", () => {
    renderRail();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });

  // The "What I noticed" shelf is deliberately absent (Mitchell, preview
  // feedback on PR #55; the 2026-08-24 design's panel markup has no such
  // block either). Asserted, not merely deleted, so re-adding it is a
  // failing test rather than a silent regression.
  it("has no \"What I noticed\" shelf, and holds the conversation space with the design's hint", () => {
    renderRail();
    expect(screen.queryByText("What I noticed")).toBeNull();
    expect(screen.getByText("Ask about this trip and the conversation stays here.")).not.toBeNull();
  });

  // SPEC §23 / DRIFT §2i: the sheet's copy is derived from the surface it was
  // opened on, and the default sentence is a trip-wide claim — false on a
  // day-scoped or page-scoped sheet, which is exactly where the phone opens
  // it. `phoneAskContext` supplies the honest one; this is the seam it arrives
  // through. Both halves asserted, because a prop that is accepted and then
  // ignored would leave the test above green on its own.
  it("prints the caller's empty hint instead of the default when it is given one", () => {
    renderRail({ emptyHint: "It reads the page you have open, its widgets and what they are pointed at." });
    expect(
      screen.getByText("It reads the page you have open, its widgets and what they are pointed at."),
    ).not.toBeNull();
    expect(screen.queryByText("Ask about this trip and the conversation stays here.")).toBeNull();
  });

  it("the Ask box is real: typing and submitting calls onAsk with the typed text", async () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Where am I overbooked?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledWith("Where am I overbooked?");
    // Awaited: the clear now waits on onAsk's answer, because a refused ask
    // keeps the prompt. An accepted one still clears, one microtask later.
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  // The refusal half of the same rule. TripBoardScreen returns false when
  // unsent edits are still queued; the ask never reaches the model, so making
  // the user retype it would read as the box being broken.
  it("keeps the typed prompt when onAsk refuses the ask", async () => {
    const onAsk = vi.fn().mockResolvedValue(false);
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Where am I overbooked?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(onAsk).toHaveBeenCalledWith("Where am I overbooked?");

    // The prompt only survives if it survives PAST the await inside submitAsk,
    // so the flush is load-bearing and is written out rather than implied. It
    // was implied before, by `await waitFor(() => expect(onAsk)…)`: that
    // condition is satisfied on its first synchronous callback run, and what
    // actually let the clear land was waitFor's own asyncWrapper draining the
    // microtask queue inside `act`. Measured, not assumed — an unconditional
    // `setAsk("")` fails both forms — but a test whose bite comes from a
    // library implementation detail it never names is one refactor away from
    // silently asserting nothing.
    await act(async () => {
      await Promise.resolve();
    });
    expect((input as HTMLInputElement).value).toBe("Where am I overbooked?");
  });

  it("submits on Enter", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk });
    const input = screen.getByPlaceholderText(/ask about this day/i);
    fireEvent.change(input, { target: { value: "Cheapest way between cities" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAsk).toHaveBeenCalledWith("Cheapest way between cities");
  });

  it("disables the Ask input/button and shows a busy label while asking", () => {
    renderRail({ asking: true });
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Asking…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an inline error when the last ask failed", () => {
    renderRail({ askError: "The model is unavailable right now." });
    expect(screen.getByRole("alert").textContent).toBe("The model is unavailable right now.");
  });

  it("the Hide control is real: clicking it calls onHide", () => {
    const onHide = vi.fn();
    renderRail({ onHide });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("shows a Simulated badge when the last answer came from the server, not a model", () => {
    render(<AssistantRail {...baseProps} simulated />);
    expect(screen.getByText("Simulated")).not.toBeNull();
  });

  it("shows no badge for a real answer", () => {
    render(<AssistantRail {...baseProps} />);
    expect(screen.queryByText("Simulated")).toBeNull();
  });

  // ---- M16 Wave 2: the conversation ----

  it("renders the thread when there is one, both sides of it", () => {
    const turns: AssistantTurn[] = [
      { id: "u1", role: "user", text: "What's the plan for day 2?" },
      { id: "a1", role: "assistant", text: "Two stops.", tools: [], pending: false },
    ];
    renderRail({ turns });
    expect(screen.getByRole("log", { name: "Conversation" }).textContent).toContain("What's the plan for day 2?");
    expect(screen.getByText("Two stops.")).not.toBeNull();
  });

  it("drops the empty hint once the conversation has started", () => {
    renderRail({ turns: [{ id: "u1", role: "user", text: "hi" }] });
    expect(screen.queryByText("Ask about this trip and the conversation stays here.")).toBeNull();
  });

  it("offers the derived suggestions while the thread is empty, and asks the one you click", () => {
    const onAsk = vi.fn();
    renderRail({ onAsk, suggestions: ["What's the plan for day 3?", "Where's the most free time on day 3?"] });
    const chips = within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual([
      "What's the plan for day 3?",
      "Where's the most free time on day 3?",
    ]);
    fireEvent.click(chips[0]!);
    expect(onAsk).toHaveBeenCalledWith("What's the plan for day 3?");
  });

  // They exist to START a conversation. Mid-thread they would be offering
  // questions the user may already have had answered, in the space the answers
  // themselves need.
  it("withdraws the suggestions once a conversation is running", () => {
    renderRail({
      suggestions: ["What's the plan for day 3?"],
      turns: [{ id: "u1", role: "user", text: "hi" }],
    });
    expect(screen.queryByRole("list", { name: "Suggested questions" })).toBeNull();
  });

  it("renders no suggestion list at all when the trip yields none", () => {
    renderRail({ suggestions: [] });
    expect(screen.queryByRole("list", { name: "Suggested questions" })).toBeNull();
  });

  it("disables the suggestions while a turn is streaming", () => {
    renderRail({ suggestions: ["How is the trip looking?"], asking: true });
    expect((screen.getByRole("button", { name: "How is the trip looking?" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("offers New conversation only once there is a conversation to clear", () => {
    const onNewConversation = vi.fn();
    const { rerender } = renderRail();
    expect(screen.queryByRole("button", { name: "New conversation" })).toBeNull();
    rerender(
      <AssistantRail
        {...baseProps}
        onNewConversation={onNewConversation}
        turns={[{ id: "u1", role: "user", text: "hi" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(onNewConversation).toHaveBeenCalledOnce();
  });

  // The board sets this when a turn it had already accepted was rolled back.
  // Same promise the `false` refusal above keeps, kept a moment later.
  it("puts a rolled-back question back in the composer", () => {
    const { rerender } = renderRail();
    const input = screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement;
    expect(input.value).toBe("");
    rerender(<AssistantRail {...baseProps} restoreDraft="a very long question" />);
    expect(input.value).toBe("a very long question");
  });

  it("leaves the composer alone while there is nothing to restore", () => {
    renderRail({ restoreDraft: null });
    expect((screen.getByPlaceholderText(/ask about this day/i) as HTMLInputElement).value).toBe("");
  });
});

// Finding 3 of the final branch review: the composer said "this day" under a
// context line that said "Looking at <trip>". Both are worded from the same
// scope now, so they cannot contradict each other.
describe("AssistantRail — the composer follows the scope", () => {
  it("asks about the day when the turn is day-scoped", () => {
    renderRail({ scope: { kind: "day", dayIndex: 1 } });
    expect(screen.getByPlaceholderText("Ask about this day…")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Ask about this trip…")).toBeNull();
  });

  it("asks about the trip when the turn is trip-scoped", () => {
    renderRail({ scope: { kind: "trip" }, contextLine: "Looking at Kyoto 2027" });
    expect(screen.getByPlaceholderText("Ask about this trip…")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Ask about this day…")).toBeNull();
  });
});

// SPEC §23: the phone gets the assistant as a bottom sheet over what it was
// already looking at. Two things this block can honestly assert, and one it
// cannot. It CAN assert the scrim is real and dismisses (DRIFT.md build-check
// 4c's whole point is that the tab bar behind an open sheet must not be
// reachable, and a scrim that renders but does not close is the half-built
// version of that), and it CAN assert the sheet kept ONE way out rather than
// gaining a second. It CANNOT assert the 44px floor or the z-index order:
// jsdom applies no stylesheet, so `getComputedStyle` here would report the
// defaults for every rule in `globals.css` and a test built on it would pass
// against no geometry at all. Those live in the browser lane.
describe("AssistantRail — SPEC §23's sheet presentation", () => {
  it("lays a scrim over the page, and clicking it hides the assistant", () => {
    const onHide = vi.fn();
    renderRail({ presentation: "sheet", onHide });
    fireEvent.click(screen.getByTestId("assistant-scrim"));
    expect(onHide).toHaveBeenCalledOnce();
  });

  // The scrim covers the phone tab bar, so a presentation that is not over a
  // phone must not have one: docked is a flex sibling with nothing to cover
  // (the scrim that used to sit in front of it was deleted outright — KI-16,
  // KI-17), and floating is a desktop card whose whole premise is that the
  // page behind it stays live.
  it("renders no scrim in the docked or floating presentations", () => {
    const { rerender } = renderRail({ presentation: "docked" });
    expect(screen.queryByTestId("assistant-scrim")).toBeNull();
    rerender(<AssistantRail {...baseProps} presentation="floating" />);
    expect(screen.queryByTestId("assistant-scrim")).toBeNull();
  });

  // One control, not two. The scrim is a dismissal SURFACE and the design
  // draws exactly one dismissal BUTTON — an ✕ where docked and floating write
  // "Hide" — so a sheet carrying both would be the same act rendered twice in
  // a 390px row (RULES.md rule 4).
  it("carries exactly one dismissal control, the design's ✕ where docked says Hide", () => {
    renderRail({ presentation: "sheet" });
    expect(screen.getAllByRole("button", { name: /hide|close|dismiss/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hide" }).textContent).toBe("✕");
    expect(screen.queryByText("Hide")).toBeNull();
  });

  // §23 keeps the panel: same mark, same heading, same stated scope. "Scope is
  // stated, never inferred by the user" is the section's own rule, and the
  // context line is where it is stated.
  it("keeps the panel's mark, heading and context line", () => {
    renderRail({ presentation: "sheet" });
    expect(screen.getByText("◎")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Assistant" })).not.toBeNull();
    expect(screen.getByText("Looking at Day 2 · Kyoto")).not.toBeNull();
  });
});

// Finding 2: `MAX_ASK_MESSAGES` was a server 400 with no counterpart here, so
// the 41st message failed the turn and nothing said New conversation was the
// way out. `asksRemaining` is counted by the board (it owns the thread and
// builds what is posted); the rail owns what to do about it.
describe("AssistantRail — the thread's ceiling", () => {
  const someThread: AssistantTurn[] = [
    { id: "u1", role: "user", text: "How is the trip looking?" },
    { id: "a1", role: "assistant", text: "Three days.", tools: [], pending: false },
  ];

  it("says nothing while the thread has room", () => {
    renderRail({ turns: someThread, asksRemaining: 4 });
    expect(screen.queryByText(/room for/i)).toBeNull();
    expect(screen.getByPlaceholderText(/ask about this/i)).not.toBeNull();
  });

  it("warns as the thread fills, in questions rather than messages", () => {
    renderRail({ turns: someThread, asksRemaining: 3 });
    expect(screen.getByText("Room for 3 more questions in this conversation.")).not.toBeNull();
    // Still usable — a warning, not a wall.
    expect(screen.getByPlaceholderText(/ask about this/i)).not.toBeNull();
  });

  it("counts the last one in the singular", () => {
    renderRail({ turns: someThread, asksRemaining: 1 });
    expect(screen.getByText("Room for 1 more question in this conversation.")).not.toBeNull();
  });

  it("replaces the composer with the way out once it is full", () => {
    const onNewConversation = vi.fn();
    renderRail({ turns: someThread, asksRemaining: 0, onNewConversation });
    // The composer is gone rather than sitting there looking ready.
    expect(screen.queryByPlaceholderText(/ask about this/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(screen.getByText(/reached its limit of 40 messages/)).not.toBeNull();

    // And the exit is a real control, clicked rather than typed at.
    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  // Nothing is dropped behind the user's back: the thread they can see is the
  // thread that exists until they say otherwise.
  it("still shows the whole conversation when it is full", () => {
    renderRail({ turns: someThread, asksRemaining: 0 });
    expect(screen.getByText("How is the trip looking?")).not.toBeNull();
    expect(screen.getByText("Three days.")).not.toBeNull();
  });
});
