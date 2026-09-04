import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PageScreen } from "./PageScreen";
import { CURRENT_PAGE_DOC_VERSION } from "@tc/contracts";
import { pageFixture, tripDetailFixture } from "@tc/factories";
import { makePagesHandlers } from "@/mocks/handlers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// jsdom has no layout engine, so ProseMirror's coordinate-based cursor
// placement throws on `elementFromPoint`/`getClientRects`. Stubbed in the same
// shape as `editor/PageEditor.test.tsx`. Without them the editor cannot place a
// caret, which both suites below depend on: `insertContent` at the cursor is
// what item G is about, and the autosave test would otherwise pass vacuously by
// never typing at all.
beforeEach(() => {
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

const server = setupServer(
  // Every notebook page fetches the account now (ADR-037 open question 2), so
  // this is a suite-wide default rather than a line in each test. Individual
  // tests override it with `server.use` when the account is what they are
  // about. Without it the suite's `onUnhandledRequest: "error"` logs on every
  // test, which is how a genuinely unhandled request later gets missed.
  http.get("/api/account/preferences", () =>
    HttpResponse.json({ preferences: { displayName: null, homeAirport: null, distanceUnit: "km" } }),
  ),
  // Same reasoning as the account default above: every notebook page now asks
  // for the trip's addressable collections (ADR-037 open question 4).
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

// ADR-037 open question 2: the account is always in scope. This is the only
// test that proves `WidgetContext.user` actually ARRIVES — everything else
// about it is types, and a typed field nothing populates renders "not set up"
// forever without failing anything.
describe("PageScreen and the account (ADR-037 open question 2)", () => {
  const pageWithAccountName = {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "macro", attrs: { name: "account.name", params: {} } }] },
    ],
  };

  async function renderWithPreferences(preferences: unknown | null) {
    const trip = tripDetailFixture();
    const page = pageFixture({ tripId: trip.tripId, content: pageWithAccountName as never });
    server.use(
      ...makePagesHandlers([page]),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
      http.get("/api/account/preferences", () =>
        preferences === null
          ? HttpResponse.json({ error: "boom" }, { status: 500 })
          : HttpResponse.json({ preferences }),
      ),
    );
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
  }

  it("renders the account's chosen name in a widget on the page", async () => {
    await renderWithPreferences({ displayName: "Priya", homeAirport: "SFO", distanceUnit: "km" });
    expect(await screen.findByText("Priya")).toBeTruthy();
  });

  it("still opens the notebook when the preferences request fails, and says the widget is not set up", async () => {
    // The trade this makes explicit: a preferences fetch is not a page
    // dependency. Failing it must cost one widget, never the notebook — the
    // page below must still render rather than showing the error screen.
    await renderWithPreferences(null);
    expect(await screen.findByText("no name set")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the widget is not set up rather than falling back to anything else", async () => {
    // ADR-037 decision 6, and the reason this widget does NOT use
    // `lib/displayName.ts`'s fallback chain: that chain ends at the email
    // address, and a notebook is a shared document.
    //
    // `homeAirport` is deliberately NON-empty. CodeRabbit caught this on #134:
    // with every other preference null too, a resolver that wrongly fell back
    // to a sibling field would still render "no name set" and this test would
    // still pass. A real value there makes that fallback observable: the widget
    // must still say "no name set", and "SFO" must appear nowhere.
    //
    // CodeRabbit also suggested scoping the assertion to the widget's own node
    // via `closest('[data-macro-name="account.name"]')`. Not taken: that trips
    // `testing-library/no-node-access`, which KI-2026-09-02-b grandfathers for
    // existing violations and says not to add more of. It buys nothing here
    // either — breaking the resolver to fall back to `homeAirport` fails the
    // first assertion below on its own, which is how this was checked.
    await renderWithPreferences({ displayName: null, homeAirport: "SFO", distanceUnit: "km" });
    expect(await screen.findByText("no name set")).toBeTruthy();
    expect(screen.queryByText("SFO")).toBeNull();
  });
});

// M14 item G, end to end and from the reader's side: this is the first thing in
// the builder half a person can actually click. Insert a widget from the
// sidebar, point it at a day from its chrome row, and watch it save.
describe("PageScreen: inserting and pointing a widget (item G)", () => {
  async function openPage(options: { reachInsert?: boolean } = {}) {
    const dayId = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
    const trip = tripDetailFixture({
      days: [
        { dayId, activityIds: [], date: "2027-06-01", costSubtotal: 0 },
        { dayId: "2b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", activityIds: [], date: "2027-06-02", costSubtotal: 0 },
      ],
    });
    const page = pageFixture({
      tripId: trip.tripId,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
    });
    const onUpdate = vi.fn();
    server.use(
      ...makePagesHandlers([page], { onUpdate }),
      http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })),
      // The suite default answers with no days at all, which is fine for every
      // widget that reads `TripDetail` and useless for the one that does not.
      // `day.city` is served entirely by this projection.
      http.get("/api/trips/:tripId/globals", () =>
        HttpResponse.json({
          globals: {
            days: [
              { index: 0, date: "2027-06-01", cities: ["Lisbon"], activityCount: 0, costSubtotal: 0 },
              { index: 1, date: "2027-06-02", cities: ["Porto"], activityCount: 0, costSubtotal: 0 },
            ],
            cities: [
              { name: "Lisbon", dayIndexes: [0], activityCount: 0 },
              { name: "Porto", dayIndexes: [1], activityCount: 0 },
            ],
            tags: [],
            bookedCount: 0,
          },
        }),
      ),
    );
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
    await screen.findByText("Notes");
    // A page opens in READING now (Mitchell, 2026-09-04), so a test about
    // authoring says so rather than relying on the default. That is the honest
    // shape: the default is a product decision, and a spec that silently
    // depended on it is how the previous default came to be defended by a test
    // instead of by a reason.
    await userEvent.click(screen.getByRole("button", { name: "Edit page" }));
    if (options.reachInsert === false) return { onUpdate };
    // The widget list lives in a popover now rather than in an `<aside>` beside
    // the document (Mitchell: *"they should be more of a popover side bar so
    // they dont interrupt the document flow"*), so reaching a widget is two
    // clicks and the popover closes behind each insert — the caret goes back
    // to the document, which is where the author was.
    await userEvent.click(screen.getByRole("button", { name: "Insert a widget" }));
    return { onUpdate };
  }

  it("opens in Reading, and Reading hides the WHOLE authoring surface", async () => {
    // Reading is the default (Mitchell, 2026-09-04, walking the preview), and
    // Reading is the traveller's view (§18): no insert affordance, no chrome
    // row, and — the part that was missing — no compose box either.
    const trip = tripDetailFixture({ days: [] });
    const page = pageFixture({
      tripId: trip.tripId,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Notes" }] }] },
    });
    server.use(...makePagesHandlers([page]), http.get("/api/trips/:tripId", () => HttpResponse.json({ trip })));
    render(<PageScreen tripId={trip.tripId} pageId={page.id} />);
    await screen.findByText("Notes");

    expect(screen.queryByRole("button", { name: "Insert a widget" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    // The compose box is an authoring control too. Leaving it mounted made
    // "Reading" a lie: it replaces the whole document and autosaves it, so a
    // page in Reading could still be rewritten by the assistant.
    expect(screen.queryByLabelText(/ask ai to add to this page/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit page" }));
    expect(screen.getByRole("button", { name: "Insert a widget" })).toBeTruthy();
    expect(screen.getByLabelText(/ask ai to add to this page/i)).toBeTruthy();
  });

  it("lists widgets by the name a person calls them, not by their stored id", async () => {
    await openPage();
    // `title`, not `name`: "cost.trip" is a stored identifier a document keeps
    // forever, and it is not what a sidebar shows a reader.
    expect(screen.getByRole("button", { name: /What the trip costs/ })).toBeTruthy();
    expect(screen.queryByText("cost.trip")).toBeNull();
  });

  it("inserts a widget at the cursor and renders it live", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: /What the trip costs/ }));
    // It resolved against the loaded trip rather than rendering a placeholder:
    // the fixture has no costs, so the widget's own emptyText is what shows.
    expect(await screen.findByText("no costs yet")).toBeTruthy();
  });

  it("points a day widget at a day from its own chrome row, and saves it", async () => {
    // The whole reason the chrome row exists: with no modal step at insert
    // time, a day widget lands UNBOUND and this is where it gets pointed.
    const { onUpdate } = await openPage();
    await userEvent.click(screen.getByRole("button", { name: /What a day costs/ }));

    // Unbound on arrival — not silently defaulted to day 1 (ADR-037 decision 6).
    expect(await screen.findByText("no day set")).toBeTruthy();

    const select = screen.getByRole("combobox", { name: /What a day costs/ });
    // And the CONTROL agrees with the widget. Asserting only the widget's text
    // let a break through where the select displayed "Day 1" while the widget
    // still said "no day set" — a control lying about what the document holds,
    // which is worse than either state alone because the reader believes it.
    expect((select as HTMLSelectElement).value).toBe("");
    await userEvent.selectOptions(select, "1");

    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
    const saved = onUpdate.mock.calls.at(-1)![1].content as { content: unknown[] };
    // The binding is stored on the widget instance's own params — ADR-035
    // decision 3, and what lets two widgets on one page read two different days.
    expect(JSON.stringify(saved.content)).toContain('"index":1');
  });

  it("lets two widgets on one page point at different days", async () => {
    // ADR-037 open question 1, settled by Mitchell: "i should be able to have a
    // notebook that shows day 1, day 3 and day 9". Each widget carries its own
    // binding, so this is the assertion that an aggregated control would break.
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: /What a day costs/ }));
    // Re-opened, because the popover closes behind each insert.
    await userEvent.click(screen.getByRole("button", { name: "Insert a widget" }));
    await userEvent.click(screen.getByRole("button", { name: /A day's stops/ }));

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(2);
    await userEvent.selectOptions(selects[0]!, "0");
    await userEvent.selectOptions(selects[1]!, "1");

    expect((selects[0] as HTMLSelectElement).value).toBe("0");
    expect((selects[1] as HTMLSelectElement).value).toBe("1");
  });

  // The globals seam, end to end, and the only test that walks it. `day.city`
  // is the one widget served by NOTHING on `TripDetail` — its cities come from
  // the projection item D built, which travels a separate route
  // (`GET /api/trips/:id/globals`), a separate piece of screen state, and the
  // editor context before it reaches a resolver. Every other widget would keep
  // rendering if that whole chain were cut; this one would quietly say "no city
  // on this day", which reads like a trip with no cities rather than a bug.
  it("renders a widget that is served only by the globals projection", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: /A day's city/ }));

    const select = screen.getByRole("combobox", { name: /A day's city/ });
    await userEvent.selectOptions(select, "1");

    // Day 2 is Porto. Asserting the SECOND day rather than the first is what
    // makes this about the binding as well as the fetch: a widget that ignored
    // its day and always read `days[0]` would pass on "Lisbon".
    expect(await screen.findByText("Porto")).toBeTruthy();
  });

  // The phone Notebook — design handoff 2026-09-03, `SPEC.md` §19. The model is
  // identical (DRIFT §2f: *"This adds no API surface"*); what differs is
  // density, and these tests are about the two places it differs. Everything
  // above this block takes the desktop branch through `useIsPhone`'s feature
  // detection, which is what keeps them meaningful as desktop tests.
  describe("on a phone", () => {
    function setPhone(matches: boolean) {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: (query: string) => ({
          matches,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }),
      });
    }

    afterEach(() => {
      Reflect.deleteProperty(window, "matchMedia");
    });

    // §19: "Insert is the desktop sheet, full height… two steps inside it."
    // Browse, then point it at — not a sheet over a sheet (project rule 3).
    it("inserts through a sheet with a bind step, and lands the widget already pointed", async () => {
      setPhone(true);
      const { onUpdate } = await openPage({ reachInsert: false });
      await userEvent.click(screen.getByRole("button", { name: "Insert a widget" }));

      // Step 1: browse. The same registry, the same order, the same copy.
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: /What a day costs/ }));

      // Step 2: point it at. This is what the desktop does NOT have — there the
      // widget lands at the caret with its chrome row under it, so a bind step
      // would be the same choice offered twice (project rule 4).
      const select = within(dialog).getByRole("combobox", { name: /day/i });
      await userEvent.selectOptions(select, "1");
      await userEvent.click(within(dialog).getByRole("button", { name: "Insert it" }));

      // It arrives BOUND. A phone insert that landed unbound would mean the
      // bind step decided nothing, which is the failure worth catching here.
      await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
      const saved = JSON.stringify(onUpdate.mock.calls.at(-1)![1].content);
      expect(saved).toContain('"cost.day"');
      expect(saved).toContain('"index":1');
    });

    // §19's one real divergence, and it is density: at 390px the desktop chrome
    // row — a name chip plus a select per input, inline — wraps into
    // unreadability. So the phone shows the resolved binding on a button and
    // opens the same controls in a sheet.
    it("shows one 'Pointed at' button per widget instead of an inline select row", async () => {
      setPhone(true);
      await openPage({ reachInsert: false });
      await userEvent.click(screen.getByRole("button", { name: "Insert a widget" }));
      await userEvent.click(
        within(await screen.findByRole("dialog")).getByRole("button", { name: /What a day costs/ }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Insert it" }));

      // The inline row is GONE — both halves matter. A phone that showed the
      // button *and* kept the select row would be the same binding twice
      // (project rule 4), and would not have fixed the wrapping this replaces.
      expect(screen.queryByRole("combobox")).toBeNull();
      const bind = await screen.findByRole("button", { name: /Pointed at/ });
      // The label IS the binding, not the widget's name: §19 rule — "binds
      // render on binds, not on name pills".
      expect(bind.textContent).toContain("Not set up");

      await userEvent.click(bind);
      const sheet = await screen.findByRole("dialog");
      await userEvent.selectOptions(within(sheet).getByRole("combobox"), "0");
      // The sheet is a Radix Dialog, so it `aria-hidden`s the page behind it —
      // the button below is genuinely unreachable until it closes, and that is
      // the correct accessibility behaviour rather than something to work
      // around with a raw DOM query.
      await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));

      // And the button follows the document, rather than being a label written
      // once at insert time. A widget rebound through the sheet whose button
      // still reads its old binding is the control-contradicts-the-document
      // bug, from the third surface.
      await vi.waitFor(() =>
        expect(screen.getByRole("button", { name: /Pointed at Day 1/ })).toBeTruthy(),
      );
    });
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
    expect(screen.queryByLabelText(/ask ai to add to this page/i)).toBeNull();
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
    // The document mounts in Reading, so the editor exists but is not editable.
    // Autosave is an EDITING behaviour now, which is the point of Reading — so
    // this walks the same path a person does: switch on, then type.
    expect(screen.queryByRole("status")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Edit page" }));
    const box = editorTextbox();
    expect(box).not.toBeNull();
    await userEvent.type(box!, "x");

    // The autosave debounce is 800 ms, so the default 1 s poll window is too
    // tight to be reliable here.
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled(), { timeout: 3000 });
    // And what it wrote carries its version (decision 2).
    expect(onUpdate.mock.calls[0]![1].content.v).toBe(CURRENT_PAGE_DOC_VERSION);
  });
});
