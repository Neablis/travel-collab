import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SuggestionDraft } from "@/components/trip/context/TripProvider";
import { SuggestionTray } from "./SuggestionTray";

afterEach(cleanup);

const draftOf = (overrides: Partial<SuggestionDraft> = {}): SuggestionDraft => ({
  count: 1,
  sending: false,
  error: null,
  discard: vi.fn(),
  send: vi.fn(async () => true),
  ...overrides,
});

const tray = () => screen.getByRole("region", { name: "Suggestion draft" });

describe("SuggestionTray", () => {
  it("shows nothing with an empty draft", () => {
    render(<SuggestionTray draft={draftOf({ count: 0 })} />);
    expect(screen.queryByRole("region", { name: "Suggestion draft" })).toBeNull();
  });

  it("counts the changes not sent", () => {
    const { rerender } = render(<SuggestionTray draft={draftOf({ count: 1 })} />);
    expect(within(tray()).getByText("1 change not sent")).toBeTruthy();
    rerender(<SuggestionTray draft={draftOf({ count: 3 })} />);
    expect(within(tray()).getByText("3 changes not sent")).toBeTruthy();
  });

  it("sends with the note, and discards", async () => {
    const draft = draftOf();
    render(<SuggestionTray draft={draft} />);

    const note = within(tray()).getByLabelText("Note for the planners");
    fireEvent.change(note, { target: { value: "Swap these two?" } });
    fireEvent.click(within(tray()).getByRole("button", { name: "Send suggestion" }));
    expect(draft.send).toHaveBeenCalledWith("Swap these two?");
    // Stored, so the note goes with the draft it described.
    await waitFor(() => expect((note as HTMLTextAreaElement).value).toBe(""));

    fireEvent.click(within(tray()).getByRole("button", { name: "Discard" }));
    expect(draft.discard).toHaveBeenCalledTimes(1);
  });

  // Review of #311, finding 3.2: the tray renders nothing at a count of 0
  // but stays mounted, so a discarded draft's note came back with the next edit.
  it("discarding the draft discards its note too", () => {
    const draft = draftOf();
    const { rerender } = render(<SuggestionTray draft={draft} />);
    fireEvent.change(within(tray()).getByLabelText("Note for the planners"), { target: { value: "Swap these two?" } });

    fireEvent.click(within(tray()).getByRole("button", { name: "Discard" }));
    rerender(<SuggestionTray draft={{ ...draft, count: 0 }} />);
    rerender(<SuggestionTray draft={{ ...draft, count: 1 }} />);

    expect((within(tray()).getByLabelText("Note for the planners") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the note when the send is refused, and says why", async () => {
    const draft = draftOf({ send: vi.fn(async () => false) });
    const { rerender } = render(<SuggestionTray draft={draft} />);

    const note = within(tray()).getByLabelText("Note for the planners") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "Swap these two?" } });
    fireEvent.click(within(tray()).getByRole("button", { name: "Send suggestion" }));
    await waitFor(() => expect(draft.send).toHaveBeenCalled());

    const error = "“Added Day 2” no longer applies to the trip as it is now. Nothing was sent.";
    rerender(<SuggestionTray draft={{ ...draft, error }} />);
    expect(within(tray()).getByText(error)).toBeTruthy();
    expect(note.value).toBe("Swap these two?");
  });

  it("holds both buttons while a send is out", () => {
    render(<SuggestionTray draft={draftOf({ sending: true })} />);
    expect((within(tray()).getByRole("button", { name: "Send suggestion" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(tray()).getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("bounds the note at the contract's limit", () => {
    render(<SuggestionTray draft={draftOf()} />);
    expect((within(tray()).getByLabelText("Note for the planners") as HTMLTextAreaElement).maxLength).toBe(500);
  });
});
