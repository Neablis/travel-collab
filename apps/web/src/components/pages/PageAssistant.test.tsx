import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    await openRail();
    const composer = screen.getByPlaceholderText(/add to this page/i);
    await userEvent.type(composer, "Add a packing list{Enter}");
    expect(await screen.findByText("Bring a raincoat")).toBeTruthy();

    askAssistantMock.mockImplementation(
      turnEmitting({
        type: "page-inserts",
        content: newPageDoc([{ type: "paragraph", content: [{ type: "text", text: "And a power adapter" }] }]),
      }),
    );
    await userEvent.type(composer, "One more thing{Enter}");

    expect(await screen.findByText("And a power adapter")).toBeTruthy();
    // The first turn's text is STILL THERE. That is the whole difference
    // between an insert and a compose, and the assertion that fails if the
    // tools ever go back to replacing.
    expect(screen.getByText("Bring a raincoat")).toBeTruthy();
  });

  // The thread is what a rail is for, and what the prompt box could not have.
  it("posts the whole conversation back on the second turn", async () => {
    await openRail();
    const composer = screen.getByPlaceholderText(/add to this page/i);
    await userEvent.type(composer, "Add a packing list{Enter}");
    await screen.findByText("Bring a raincoat");
    await userEvent.type(composer, "One more thing{Enter}");

    await waitFor(() => expect(askAssistantMock).toHaveBeenCalledTimes(2));
    const [, messages] = askAssistantMock.mock.calls[1]!;
    const texts = (messages as AskWireMessage[]).map((m) => m.parts[0]!.text);
    expect(texts).toContain("Add a packing list");
    expect(texts).toContain("One more thing");
  });
});
