import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIP_VIEWS } from "@tc/contracts";
import { VIEWS } from "@/components/trip/context/LensRouter";
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

    expect(runPaletteCommands([go], false)).toEqual({ notes: [], awaiting: [] });
    expect(setView).toHaveBeenCalledTimes(1);
  });

  // §5: availability is the page's. An id it does not offer does nothing, and
  // the reply says so rather than leaving the model's "Switching to Map" alone.
  it("says it couldn't, and runs nothing, for an id this page does not offer", () => {
    const setView = vi.fn();
    offer({ id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView });

    const run = runPaletteCommands([{ id: `go:day:${DAY}`, needsApproval: false }], false);
    expect(run.notes).toEqual(["I couldn't go to that day from this page."]);
    expect(setView).not.toHaveBeenCalled();
  });

  // §4: neither runs while the page holds unsaved input; the reply says what it
  // would have done instead.
  it("runs nothing while the page holds unsaved input, and says what it would have done", () => {
    const setView = vi.fn();
    offer({ id: "view:Map", action: "Go to", type: "View", target: { label: "Map" }, run: setView });

    expect(runPaletteCommands([go], true).notes).toEqual([
      "I didn't switch to Map, because this page has changes you haven't saved.",
    ]);
    expect(setView).not.toHaveBeenCalled();
  });

  // §4: a change asks. It is handed back for a card, and nothing runs yet.
  it("hands a command that needs Approve back without running it", () => {
    const toggle = vi.fn();
    offer({ id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle });
    const editing = { id: "notebook-editing", needsApproval: true };

    expect(runPaletteCommands([editing], false)).toEqual({ notes: [], awaiting: [editing] });
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

// The allowlist's view names live in the contract, which the UI's own list
// cannot import from the other way round. If they part, the assistant names a
// view the page has no command for, or never names one it has.
it("names the same views the trip page has", () => {
  expect([...TRIP_VIEWS]).toEqual([...VIEWS]);
});
