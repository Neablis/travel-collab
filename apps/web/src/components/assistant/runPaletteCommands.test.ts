import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPaletteCommands, type PaletteCommand } from "@/components/palette/paletteRegistry";
import { decideOffer, offerPaletteCommand, offerStatus, runPaletteCommands } from "./runPaletteCommands";

const DAY = "22222222-2222-4222-8222-222222222222";

const taken: Array<() => void> = [];
afterEach(() => {
  taken.splice(0).forEach((takeBack) => takeBack());
});

function offer(...commands: PaletteCommand[]) {
  taken.push(registerPaletteCommands("test", commands));
}

const go = { id: "view:Map", needsApproval: false };

// ADR-072 §1: the assistant names a command and the page runs it, so what runs
// is the function the screen registered, the one ⌘K runs, never a copy.
describe("running the commands a reply named", () => {
  it("runs the registered command's own `run`, once", () => {
    const setView = vi.fn();
    offer({ id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView });

    expect(runPaletteCommands([go], null)).toEqual({ notes: [], awaiting: [] });
    expect(setView).toHaveBeenCalledTimes(1);
  });

  // §5: availability is the page's. An id it does not offer does nothing, and
  // the reply says so rather than leaving the model's "Switching to Map" alone.
  it("says it couldn't, and runs nothing, for an id this page does not offer", () => {
    const setView = vi.fn();
    offer({ id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView });

    const run = runPaletteCommands([{ id: `go:day:${DAY}`, needsApproval: false }], null);
    expect(run.notes).toEqual(["I couldn't go to that day from this page."]);
    expect(setView).not.toHaveBeenCalled();
  });

  // §4: a card is not kept across leaving the page, so while one waits a
  // command that leaves becomes a note, and one that stays on the page runs.
  it("leaves the page for nothing while a card waits, and still moves on it", () => {
    const setView = vi.fn();
    const openNotebook = vi.fn();
    offer(
      { id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView },
      { id: `go:notebook:${DAY}`, action: "Go to", type: "Notebook", target: { label: "Bookings" }, run: openNotebook },
    );

    expect(runPaletteCommands([go, { id: `go:notebook:${DAY}`, needsApproval: false }], "the change above is waiting for you to approve or turn it down").notes).toEqual([
      "I didn't open that notebook, because the change above is waiting for you to approve or turn it down.",
    ]);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(openNotebook).not.toHaveBeenCalled();
  });

  // §4: a change asks. It is handed back for a card, and nothing runs yet.
  it("hands a command that needs Approve back without running it", () => {
    const toggle = vi.fn();
    offer({ id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle });
    const editing = { id: "notebook-editing", needsApproval: true };

    expect(runPaletteCommands([editing], null)).toEqual({ notes: [], awaiting: [editing] });
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe("an Approve card's command", () => {
  it("runs the registered command on Approve, once, and is settled after", () => {
    const toggle = vi.fn();
    offer({ id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle });
    const key = offerPaletteCommand();

    expect(offerStatus(key)).toBe("pending");
    decideOffer(key, "notebook-editing", true);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(offerStatus(key)).toBe("ran");
    // A second press finds it settled: a toggle run twice is the opposite answer.
    decideOffer(key, "notebook-editing", true);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("runs nothing on Not now", () => {
    const toggle = vi.fn();
    offer({ id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle });
    const key = offerPaletteCommand();

    decideOffer(key, "notebook-editing", false);
    expect(toggle).not.toHaveBeenCalled();
    expect(offerStatus(key)).toBe("declined");
  });

  it("is unavailable when the page stopped offering it before Approve", () => {
    const key = offerPaletteCommand();
    decideOffer(key, "notebook-editing", true);
    expect(offerStatus(key)).toBe("unavailable");
  });
});
