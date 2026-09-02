import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskEvent, AskScope, AskWireMessage } from "@/lib/apiClient";
import { ASK_ABORTED_CODE } from "@/lib/apiClient";

const askAssistantMock = vi.fn();

vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    askAssistant: (...args: unknown[]) => askAssistantMock(...args),
  };
});

import { ComposePanel } from "./ComposePanel";

const PAGE_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DOC = { type: "doc" as const, content: [{ type: "paragraph", content: [] }] };

/** The turn as `askAssistant` runs it: emit these events, then resolve `ok`. */
function turnEmitting(...events: AskEvent[]) {
  return async (_tripId: string, _messages: AskWireMessage[], _scope: AskScope, onEvent: (e: AskEvent) => void) => {
    for (const event of events) onEvent(event);
    return { ok: true as const, value: { text: "" } };
  };
}

afterEach(cleanup);

beforeEach(() => {
  askAssistantMock.mockReset();
  askAssistantMock.mockImplementation(turnEmitting({ type: "page", title: "Trip Overview", content: DOC }));
});

const type = (text: string) => userEvent.type(screen.getByLabelText(/ask ai to draft this page/i), text);

// The panel talks to /ask now (ADR-033 Decision 4) rather than awaiting a
// non-streaming `{ content }` from the command endpoint. What has to survive
// that rewrite is the contract the Notebook and the M7 e2e depend on: the label,
// the Generate button, Enter-submits/Shift+Enter-newlines, and the Simulated
// badge.
describe("ComposePanel", () => {
  it("asks /ask with a page scope carrying THIS page's id, and nothing else about the page", async () => {
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    await type("Add a packing list{Enter}");

    const [tripId, messages, scope] = askAssistantMock.mock.calls[0]!;
    expect(tripId).toBe("t1");
    expect(scope).toEqual({ kind: "page", pageId: PAGE_ID });
    // One message, no thread: this is a single instruction about one document,
    // not a conversation.
    expect(messages).toEqual([
      { id: "compose", role: "user", parts: [{ type: "text", text: "Add a packing list" }] },
    ]);
  });

  it("hands the composed doc to onApply and clears the prompt", async () => {
    const onApply = vi.fn();
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={onApply} />);

    await type("Add a packing list{Enter}");

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(DOC));
    expect((screen.getByLabelText(/ask ai to draft this page/i) as HTMLTextAreaElement).value).toBe("");
  });

  // Read from the server's header, never sniffed out of the model's prose — the
  // same rule the rail follows (`SIMULATED_HEADER`). `ai-live` is off in every
  // Vercel environment, so this badge is what a deployed Notebook actually shows.
  it("badges a draft the server composed because AI is switched off", async () => {
    askAssistantMock.mockImplementation(
      turnEmitting({ type: "meta", simulated: true }, { type: "page", title: "Sample page", content: DOC }),
    );
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    await type("draft it{Enter}");

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Simulated"));
  });

  it("does not badge a draft a real model wrote", async () => {
    askAssistantMock.mockImplementation(
      turnEmitting({ type: "meta", simulated: false }, { type: "page", title: "T", content: DOC }),
    );
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    await type("draft it{Enter}");

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  // The server's own reason — a macro whose params its registry schema rejects,
  // or a turn that never composed. Silently doing nothing after "Generate" is a
  // dead end, and the doc must not reach the editor either way.
  it("shows the server's compose refusal and applies nothing", async () => {
    const onApply = vi.fn();
    askAssistantMock.mockImplementation(
      turnEmitting({ type: "page-error", message: 'Macro "cost.day" params failed validation.' }),
    );
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={onApply} />);

    await type("draft it{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe('Macro "cost.day" params failed validation.'),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  // A refusal before the stream opened — 403 on the page scope the server could
  // not resolve, 429 on the quota, 503 on a broken provider.
  it("shows a refusal that arrived before the stream opened", async () => {
    askAssistantMock.mockResolvedValue({
      ok: false,
      error: { status: 404, message: "That page is not on this trip.", code: "page-not-on-trip" },
    });
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    await type("draft it{Enter}");

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That page is not on this trip."));
  });

  // A turn that streamed a usable page and THEN broke still drafted a usable
  // page. Deleting it under the user is the worse lie.
  it("keeps a page that arrived before the turn failed", async () => {
    const onApply = vi.fn();
    askAssistantMock.mockImplementation(
      async (_t: string, _m: AskWireMessage[], _s: AskScope, onEvent: (e: AskEvent) => void) => {
        onEvent({ type: "page", title: "T", content: DOC });
        return { ok: false as const, error: { status: 200, message: "boom", code: "ask-stream-error" } };
      },
    );
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={onApply} />);

    await type("draft it{Enter}");

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(DOC));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not submit on Shift+Enter, and inserts a newline instead", async () => {
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    const textarea = screen.getByLabelText(/ask ai to draft this page/i) as HTMLTextAreaElement;
    await userEvent.type(textarea, "Add a packing list{Shift>}{Enter}{/Shift}and the itinerary");

    expect(askAssistantMock).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Add a packing list\nand the itinerary");
  });

  it("does not submit on Enter when the prompt is empty", async () => {
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    screen.getByLabelText(/ask ai to draft this page/i).focus();
    await userEvent.keyboard("{Enter}");

    expect(askAssistantMock).not.toHaveBeenCalled();
  });

  // The two strings `e2e/m7-solo-delight.spec.ts` asserts by exact name.
  it("keeps the label and the button the Notebook walkthrough looks for", () => {
    render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);

    // No jest-dom in this suite (vitest.setup.ts), so presence is the assertion
    // — `getBy*` throws when the accessible name does not match exactly.
    expect(screen.getByLabelText("Ask AI to draft this page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy();
  });

  // Both reviewers on pull request 110 found the same defect: the abort ref was written
  // and never read, so the comment claiming unmount stops a turn had nothing
  // enforcing it. These two tests are that enforcement — without the cleanup
  // and the identity check in ComposePanel, each fails.
  describe("a turn the panel has walked away from", () => {
    /** A turn that never resolves until `release()` is called. */
    function heldTurn() {
      let release!: (e: AskEvent) => void;
      const started = new Promise<void>((ready) => {
        askAssistantMock.mockImplementation(
          async (
            _tripId: string,
            _messages: AskWireMessage[],
            _scope: AskScope,
            onEvent: (e: AskEvent) => void,
            signal: AbortSignal,
          ) => {
            release = onEvent;
            ready();
            await new Promise<void>((done) => signal.addEventListener("abort", () => done()));
            return { ok: false as const, error: { status: 0, message: "aborted", code: ASK_ABORTED_CODE } };
          },
        );
      });
      return { started, emit: (e: AskEvent) => release(e) };
    }

    it("aborts the request when the panel unmounts", async () => {
      const turn = heldTurn();
      const view = render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={vi.fn()} />);
      await type("Draft it");
      await userEvent.click(screen.getByRole("button", { name: "Generate" }));
      await turn.started;

      const signal = askAssistantMock.mock.calls[0]![4] as AbortSignal;
      expect(signal.aborted).toBe(false);
      view.unmount();
      expect(signal.aborted).toBe(true);
    });

    // The one a mounted-flag guard would not catch: the panel stays mounted
    // when the Notebook moves to another page, so a stale turn would otherwise
    // apply the previous page's draft to the page now on screen.
    it("does not apply a draft from the page it used to be pointed at", async () => {
      const turn = heldTurn();
      const onApply = vi.fn();
      const view = render(<ComposePanel tripId="t1" pageId={PAGE_ID} onApply={onApply} />);
      await type("Draft it");
      await userEvent.click(screen.getByRole("button", { name: "Generate" }));
      await turn.started;

      const OTHER = "11111111-2222-4333-8444-555555555555";
      view.rerender(<ComposePanel tripId="t1" pageId={OTHER} onApply={onApply} />);
      turn.emit({ type: "page", title: "Stale", content: DOC });

      await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy());
      expect(onApply).not.toHaveBeenCalled();
    });
  });
});
