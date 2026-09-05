import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { newPageDoc } from "@tc/contracts";
import { pageFixture, tripDetailFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";
import type { AskEvent, AskScope, AskWireMessage } from "@/lib/apiClient";

// M14 link 8's second half: the notebook's AI surface is the assistant rail,
// the same one the board runs — Mitchell, walking the preview (2026-09-04):
// *"This should be the same style AI Assistant as on the trip page, not the top
// of the UI input box"*.
//
// The wire is mocked at `askAssistant` rather than served as SSE, because
// `apiClient.test.ts` already owns the frame parsing and this file is about
// what the SCREEN does with an event once it has one. Everything else — the
// page fetch, the trip fetch, the autosave PATCH — is real through MSW, since
// "the insert reaches the document AND the document reaches the server" is the
// claim these tests exist to make.
const askAssistantMock = vi.fn();
vi.mock("@/lib/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/apiClient")>();
  return { ...actual, askAssistant: (...args: unknown[]) => askAssistantMock(...args) };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Imported after the `vi.mock` calls above. They are hoisted, so the order does
// not actually matter to the runtime — it is written this way so a reader is
// not left wondering whether the screen picked up the real client.
import { PageScreen } from "./PageScreen";

// The AI insert FOCUSES THE EDITOR as its last act — `PageScreen.tsx`'s
// `page-inserts` handler runs `chain().focus().insertContent(...)` — and that
// focus call lands after the inserted text has already rendered. So
// `findByText(...)` is NOT a safe signal to resume typing on: `userEvent.type`
// gets two keystrokes into the composer, the editor takes focus mid-string, and
// every remaining character — including the `{Enter}` — goes into the document
// instead. The turn is never submitted and it surfaces as a call count, which
// reads like a product bug and is not one. (That the product does this to a
// real user's follow-up is KI-2026-09-06-b; this helper only stops the tests
// racing it.)
//
// Both tests below type a SECOND message, and both were red locally while CI
// stayed green on the same tree: the race is decided by how fast the machine
// gets from render to focus (KI-2026-09-06-a).
//
// The wait is the AUTOSAVE, not the focus. `onUpdate` fires from the editor
// after the insert chain has run, so observing it means the focus call has
// already happened — and it costs no `document.activeElement`, which
// `testing-library/no-node-access` forbids and whose only existing use is
// grandfathered under KI-2026-09-02-b with "Do not add more."
async function readyForAnotherTurn(onUpdate: Mock): Promise<HTMLElement> {
  await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
  const composer = screen.getByPlaceholderText(/add to this page/i);
  await userEvent.click(composer);
  return composer;
}

const DOC = newPageDoc([{ type: "paragraph", content: [{ type: "text", text: "Bring a raincoat" }] }]);

/** The turn as `askAssistant` runs it: emit these events, then resolve `ok`. */
function turnEmitting(...events: AskEvent[]) {
  return async (
    _tripId: string,
    _messages: AskWireMessage[],
    _scope: AskScope,
    onEvent: (e: AskEvent) => void,
  ) => {
    for (const event of events) onEvent(event);
    return { ok: true as const, value: { text: "" } };
  };
}

beforeEach(() => {
  // Same jsdom geometry stubs as `PageScreen.test.tsx` — ProseMirror cannot
  // place a caret without them, and an insert at the cursor is the whole claim.
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  askAssistantMock.mockReset();
  askAssistantMock.mockImplementation(turnEmitting({ type: "page-inserts", content: DOC }));
});

const server = setupServer(
  http.get("/api/account/preferences", () =>
    HttpResponse.json({ preferences: { displayName: null, homeAirport: null, distanceUnit: "km" } }),
  ),
  http.get("/api/trips/:tripId/globals", () =>
    HttpResponse.json({ globals: { days: [], cities: [], tags: [], bookedCount: 0 } }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

async function openRail() {
  const trip = tripDetailFixture({ days: [] });
  const page = pageFixture({
    tripId: trip.tripId,
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
  });
  const onUpdate = vi.fn();
  server.use(
    ...makePagesHandlers([page], { onUpdate }),
    http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
  );
  render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
  await screen.findByText("Notes");
  await userEvent.click(screen.getByRole("button", { name: "Edit page" }));
  await userEvent.click(screen.getByRole("button", { name: /Assistant/ }));
  return { onUpdate, page, trip };
}

describe("the assistant on a notebook page", () => {
  it("asks with a page scope carrying THIS page's id", async () => {
    const { page } = await openRail();
    await userEvent.type(screen.getByPlaceholderText(/add to this page/i), "Add a packing list{Enter}");

    await waitFor(() => expect(askAssistantMock).toHaveBeenCalled());
    const [, , scope] = askAssistantMock.mock.calls[0]!;
    // Nothing else about the page goes on the wire: its title and its content
    // the server reads from the row it just verified (ADR-033 decision 4).
    expect(scope).toEqual({ kind: "page", pageId: page.id });
  });

  it("puts what the turn inserted into the document, and autosaves it", async () => {
    const { onUpdate } = await openRail();
    await userEvent.type(screen.getByPlaceholderText(/add to this page/i), "Add a packing list{Enter}");

    // In the document — through the same `insertContent` chain a click and a
    // drop use, which is what stops the AI from having placement rules of its
    // own.
    expect(await screen.findByText("Bring a raincoat")).toBeTruthy();
    // ...and through the ordinary debounced autosave, not a second write path.
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
    expect(JSON.stringify(onUpdate.mock.calls.at(-1)![1].content)).toContain("Bring a raincoat");
  });

  // The reason the rail could not have this job until now. `compose_page`
  // REPLACED the document, and `ComposePanel`'s own header said a page that
  // accumulated turns "would have to decide what 'draft this page' means the
  // second time". ADR-035 decision 5 made the tools insert-shaped; this is that
  // second time, and it has an obvious meaning.
  it("accumulates a second turn instead of replacing the first", async () => {
    const { onUpdate } = await openRail();
    const composer = screen.getByPlaceholderText(/add to this page/i);
    await userEvent.type(composer, "Add a packing list{Enter}");
    expect(await screen.findByText("Bring a raincoat")).toBeTruthy();

    askAssistantMock.mockImplementation(
      turnEmitting({
        type: "page-inserts",
        content: newPageDoc([{ type: "paragraph", content: [{ type: "text", text: "And a power adapter" }] }]),
      }),
    );
    await userEvent.type(await readyForAnotherTurn(onUpdate), "One more thing{Enter}");

    expect(await screen.findByText("And a power adapter")).toBeTruthy();
    // The first turn's text is STILL THERE. That is the whole difference
    // between an insert and a compose, and the assertion that fails if the
    // tools ever go back to replacing.
    expect(screen.getByText("Bring a raincoat")).toBeTruthy();
  });

  // The thread is what a rail is for, and what the prompt box could not have.
  it("posts the whole conversation back on the second turn, assistant turns included", async () => {
    // The first turn ANSWERS as well as inserting, because a history of two
    // user messages passes even if the client drops every assistant turn — and
    // a model that cannot see its own last answer is not in a conversation
    // (CodeRabbit, PR 139).
    askAssistantMock.mockImplementation(
      turnEmitting(
        { type: "text", delta: "Packed you a list." },
        { type: "page-inserts", content: DOC },
      ),
    );
    const { onUpdate } = await openRail();
    const composer = screen.getByPlaceholderText(/add to this page/i);
    await userEvent.type(composer, "Add a packing list{Enter}");
    await screen.findByText("Bring a raincoat");
    await userEvent.type(await readyForAnotherTurn(onUpdate), "One more thing{Enter}");

    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));
    const [, messages] = askAssistantMock.mock.calls[1]!;
    // Order matters as much as membership: an assistant reply attributed to the
    // wrong turn is worse than one that is missing.
    expect((messages as AskWireMessage[]).map((m) => [m.role, m.parts[0]!.text])).toEqual([
      ["user", "Add a packing list"],
      ["assistant", "Packed you a list."],
      ["user", "One more thing"],
    ]);
  });

  // A turn that is still streaming when the surface changes underneath it.
  // Copilot and CodeRabbit, PR 139: `useAskThread` lives on this SCREEN, so
  // nothing about the panel going away aborts a turn on its own — and a late
  // `page-inserts` wrote into a document the user had put back into Reading,
  // and autosaved it.
  function neverSettlingTurn() {
    let emit: ((event: AskEvent) => void) | null = null;
    // The SIGNAL as well as the emitter. Watching only for late events proves
    // the guard fired, not that the request was actually hung up on — a
    // `cancel()` that dropped its ownership without calling `abort()` would
    // leave the turn running against the server and still pass (CodeRabbit,
    // PR 139).
    let signal: AbortSignal | null = null;
    askAssistantMock.mockImplementation(
      async (
        _t: string,
        _m: AskWireMessage[],
        _s: AskScope,
        onEvent: (e: AskEvent) => void,
        abortSignal: AbortSignal,
      ) => {
        emit = onEvent;
        signal = abortSignal;
        return await new Promise<never>(() => {});
      },
    );
    return { emitter: () => emit, signal: () => signal };
  }

  // **Reading never receives writes — and it is this guard that says so, not
  // the surface being taken away.** The assistant used to be unmounted on
  // leaving Editing, which both hung up the turn and hid the panel. Mitchell
  // reversed the second half — *"always available in both editing and reading
  // mode"* — so the panel is still there and the guard is now the only thing
  // between a streaming turn and a document that is being read.
  it("refuses a turn's insert once the page has left Editing, and says why", async () => {
    const { emitter } = neverSettlingTurn();
    const { onUpdate } = await openRail();
    await userEvent.type(screen.getByPlaceholderText(/add to this page/i), "Add a packing list{Enter}");
    await waitFor(() => expect(emitter()).not.toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Done editing" }));
    // The answer arrives after the user left Editing. A stream's last frame can
    // already be in flight when a turn is cancelled, so cancellation alone
    // could never close this window.
    emitter()!({ type: "page-inserts", content: DOC });

    expect(await screen.findByText(/turn on Edit page/i)).toBeTruthy();
    expect(screen.queryByText("Bring a raincoat")).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    // Still open. Hiding it was the old fix and is now the bug.
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });

  // Closing the surface IS hanging up — that half of the PR 139 fix stands.
  it("hangs up on a turn in flight when the assistant is closed", async () => {
    const { emitter, signal } = neverSettlingTurn();
    const { onUpdate } = await openRail();
    await userEvent.type(screen.getByPlaceholderText(/add to this page/i), "Add a packing list{Enter}");
    await waitFor(() => expect(emitter()).not.toBeNull());
    expect(signal()!.aborted).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /hide/i }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Assistant" })).toBeNull());
    // Hung up on the SERVER, not merely ignored on the client.
    expect(signal()!.aborted).toBe(true);

    emitter()!({ type: "page-inserts", content: DOC });
    expect(screen.queryByText("Bring a raincoat")).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // **The server's own refusal.** A page turn whose nodes fail registry
  // validation finishes with `page-error` and no content, and the REQUEST
  // succeeds — so before this the turn settled idle with an empty answer and
  // the reader was told nothing at all (Copilot, PR 139).
  //
  // `ComposePanel` surfaced it before it retired, on the argument that
  // *"Macro "cost.day" params failed validation"* is a better answer than the
  // transport's, which will just say the turn worked. The machinery came across
  // in the extraction; this did not.
  it("shows the server's reason when a page turn's nodes fail validation", async () => {
    askAssistantMock.mockImplementation(
      turnEmitting({ type: "page-error", message: 'Macro "cost.day" params failed validation.' }),
    );
    const { onUpdate } = await openRail();
    await userEvent.type(screen.getByPlaceholderText(/add to this page/i), "Add today's cost{Enter}");

    expect(await screen.findByText(/params failed validation/)).toBeTruthy();
    // Nothing reached the document, and nothing was saved — the refusal is the
    // whole outcome of the turn.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  // A refusal is about the question just asked. Left standing it would sit
  // under the next answer as if it were that one's.
  it("clears the last refusal when the next question is asked", async () => {
    askAssistantMock.mockImplementation(
      turnEmitting({ type: "page-error", message: 'Macro "cost.day" params failed validation.' }),
    );
    await openRail();
    const composer = screen.getByPlaceholderText(/add to this page/i);
    await userEvent.type(composer, "Add today's cost{Enter}");
    expect(await screen.findByText(/params failed validation/)).toBeTruthy();

    askAssistantMock.mockImplementation(turnEmitting({ type: "page-inserts", content: DOC }));
    await userEvent.type(composer, "Something else{Enter}");
    await waitFor(() => expect(screen.queryByText(/params failed validation/)).toBeNull());
  });

  // The assistant is available in Reading, which it was not. A page opens in
  // Reading, so this is the state most readers meet it in.
  it("is reachable without entering Editing at all", async () => {
    const trip = tripDetailFixture({ days: [] });
    const page = pageFixture({
      tripId: trip.tripId,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
    });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
    await screen.findByText("Notes");

    // No "Edit page" click anywhere above this line.
    expect(screen.getByRole("button", { name: "Edit page" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Assistant/ }));
    expect(screen.getByRole("complementary", { name: "Assistant" })).toBeTruthy();
  });
});
