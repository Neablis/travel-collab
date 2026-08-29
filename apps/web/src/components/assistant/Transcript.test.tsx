import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

  // Task 6 adds write tools to this same stream. An unknown name gets a civil
  // sentence, not a blank line and not `undefined`.
  it("still says something for a tool this build has never heard of", () => {
    expect(toolNoteLabel("propose_batch", null)).toBe("Used propose batch");
  });

  it("tolerates a non-object input", () => {
    expect(toolNoteLabel("read_day", "nonsense")).toBe("Checked the day you're looking at");
  });
});
