import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PageScreen } from "./PageScreen";
import userEvent from "@testing-library/user-event";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { pageFixture, tripDetailFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// jsdom has no layout engine, so ProseMirror's coordinate-based cursor
// placement throws on `elementFromPoint`/`getClientRects`. Stubbed for the same
// reason and in the same shape as `editor/PageEditor.test.tsx` — without them
// `userEvent.type` cannot place a cursor, and the autosave test below would
// pass vacuously by never typing at all.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

describe("PageScreen", () => {
  it("loads a page and renders the editor with its content", async () => {
    const trip = tripDetailFixture();
    const page = pageFixture({
      tripId: trip.tripId,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello notebook" }] }] },
    });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );

    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);

    expect(await screen.findByText("Hello notebook")).toBeTruthy();
  });

  it("resolves a day macro's own params against the loaded TripDetail", async () => {
    const dayId = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const trip = tripDetailFixture({
      days: [{ dayId, activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
    });
    const page = pageFixture({
      tripId: trip.tripId,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              // The day is the widget's, not the page's (SPEC §18): the page
              // below is about nothing in particular.
              { type: "macro", attrs: { name: "cost.day", params: { dayRef: { kind: "index", index: 0 } } } },
            ],
          },
        ],
      },
    });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );

    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);

    expect(await screen.findByText("no costs on this day")).toBeTruthy();
  });
});

// ADR-038 decision 4, end to end and from the reader's side.
//
// The loss this prevents is not exotic: open a page, and 800 ms later this
// screen writes `editor.getJSON()` back over it. When TipTap did not understand
// one node in the stored document, that `getJSON()` is an EMPTY document —
// measured in `editor/PageEditor.test.tsx`, and it takes the user's own
// paragraphs with it. So the assertion that carries the weight here is the
// negative one: `onUpdate` is never called.
describe("PageScreen given a document the editor cannot mount (ADR-038 decision 4)", () => {
  // `repeat` is a valid v1 node with no TipTap extension behind it, so this is
  // a document that parses, round-trips byte-identically, and would still cost
  // its owner the page. See `editor/storedPageDoc.test.ts` for that pair of
  // facts asserted side by side.
  const withRepeat = {
    v: 1,
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "written by the user" }] },
      { type: "repeat", attrs: { name: "day.line", params: {} }, content: [] },
    ],
  };

  // Two things on this screen have role `textbox` — the compose panel's
  // textarea and the editor itself — so "is there an editor" has to ask for
  // the contenteditable one specifically. Asking for `textbox` alone would
  // make the negative assertions below pass for the wrong reason (the compose
  // panel going away) and the positive one type into the wrong element.
  // `el.isContentEditable` is the obvious spelling and jsdom does not implement
  // it — it answers `false` for the real editor — so this reads the attribute
  // ProseMirror actually sets.
  const editorTextbox = () =>
    screen.queryAllByRole("textbox").find((el) => el.getAttribute("contenteditable") === "true") ?? null;

  async function renderWithStoredContent(content: unknown) {
    const trip = tripDetailFixture();
    const page = pageFixture({ tripId: trip.tripId, content: content as never });
    const onUpdate = vi.fn();
    server.use(
      ...makePagesHandlers([page], { onUpdate }),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
    );
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
    return { onUpdate };
  }

  it("opens read-only, explains why, and never autosaves over the page", async () => {
    const { onUpdate } = await renderWithStoredContent(withRepeat);

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("repeat");

    // No editor at all: mounting one is what destroys the document, so the
    // refusal has to be "do not mount", not "mount it and don't save".
    expect(editorTextbox()).toBeNull();

    // The reader can still READ their notebook. A banner over a blank page
    // would show them exactly the loss the guard exists to prevent.
    expect(screen.getByText("written by the user")).toBeTruthy();
    expect(screen.getByTestId("read-only-page")).toBeTruthy();

    // And nothing is written. This needs the keystroke to mean anything: the
    // loss is `onUpdate` firing with an emptied document, and it takes an edit
    // to trigger. Asserting "no PATCH" without typing passes whether or not the
    // guard exists — checked by removing the guard and watching this stay
    // green, which is CLAUDE.md rule 3 catching a test that asserted nothing.
    // So type if there is anywhere to type: with the guard there is not, and
    // without it there is, which is exactly the difference under test.
    const box = editorTextbox();
    if (box) await userEvent.type(box, "x");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("takes the compose panel away too, since applying a draft would overwrite the page", async () => {
    await renderWithStoredContent(withRepeat);
    await screen.findByRole("status");
    expect(screen.queryByLabelText(/ask ai to draft this page/i)).toBeNull();
  });

  it("locks a document it cannot parse at all, and says so without pretending to show it", async () => {
    // A heading at level 9: a broken known node, not a node from the future.
    const { onUpdate } = await renderWithStoredContent({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 9 }, content: [] }],
    });

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("can't read");
    expect(editorTextbox()).toBeNull();
    // Nothing parsed, so there is no AST to render — and inventing one would be
    // the lie. The notice stands alone.
    expect(screen.queryByTestId("read-only-page")).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("still mounts and still autosaves an ordinary document", async () => {
    // The other half of the trade ADR-038 weighed: a guard that locks pages it
    // did not need to lock costs real editing. This is the test that would
    // catch that, and it is why the two above are worth trusting.
    const { onUpdate } = await renderWithStoredContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "ordinary" }] }],
    });

    await screen.findByText("ordinary");
    const box = editorTextbox();
    expect(box).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.type(box!, "x");

    // The autosave debounce is 800 ms, so the default 1 s poll window is too
    // tight to be reliable here.
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
    // And what it wrote carries its version (decision 2).
    expect(onUpdate.mock.calls[0]![1].content.v).toBe(CURRENT_PAGE_DOC_VERSION);
  });
});
