import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult, BoardCommand, CommandOutcome } from "@/lib/apiClient";
import type { PlaceMatch } from "@/lib/cities";
import type { DiscoverDay, DiscoverResponse } from "@/lib/playbooks";

// The place search, the published-day read and its insert are the component's
// own imports, so they are replaced here. Every test starts with a library
// that holds Lisbon and a world that holds Porto, and no published days.
const library = vi.hoisted(() => ({
  places: vi.fn(),
  search: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("@/lib/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/lib/apiClient")>()),
  searchPlaces: library.places,
  searchPlaybooks: library.search,
  insertSavedDay: library.insert,
}));
// Review's buttons read a capability. `null` (unknown, or a failed read) is
// the default because `useAiEntitled` requires every caller to treat it as
// entitled.
const aiEntitled = { value: null as boolean | null };
vi.mock("@/lib/useAiEntitled", async (orig) => ({
  ...(await orig<typeof import("@/lib/useAiEntitled")>()),
  useAiEntitled: () => aiEntitled.value,
}));

import { NewTripWizard } from "./NewTripWizard";

const PLACES: PlaceMatch[] = [
  { kind: "city", city: "Lisbon", days: 4, hasPlaybooks: true },
  { kind: "world", id: "li-porto", name: "Porto", detail: "Porto, Portugal", lat: 41.15, lng: -8.61, hasPlaybooks: false },
];

beforeEach(() => {
  library.places.mockImplementation(async (q: string) => ({
    ok: true,
    value: PLACES.filter((p) => (p.kind === "city" ? p.city : p.name).toLowerCase().startsWith(q.toLowerCase())),
  }));
  library.search.mockResolvedValue(discover([]));
  library.insert.mockResolvedValue({ ok: true, value: {} as CommandOutcome });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  aiEntitled.value = null;
});

const user = userEvent.setup();

function discover(days: DiscoverDay[]): ApiResult<DiscoverResponse> {
  return {
    ok: true,
    value: {
      days,
      siblings: [],
      budgetCurrency: null,
      truncated: false,
      matchCount: days.length,
      matchCountExact: true,
      sharedPlaybookCount: days.length,
      nextCursor: null,
    },
  };
}

function published(overrides: Partial<DiscoverDay> & Pick<DiscoverDay, "savedDayId" | "name" | "adds">): DiscoverDay {
  return {
    ownerId: "dev-mei",
    ownerDisplayName: "Mei L.",
    cities: ["Lisbon"],
    matchedCities: ["Lisbon"],
    stopCount: 4,
    dayCount: 1,
    window: null,
    preview: [],
    totalCost: null,
    rating: null,
    reviewCount: 0,
    visibility: "public",
    authorKind: "human",
    sourceTripName: "Portugal",
    createdAt: "2026-09-01T00:00:00.000Z",
    publishedAt: "2026-09-02T00:00:00.000Z",
    isMine: false,
    cover: null,
    description: null,
    tags: [],
    namedTags: [],
    linkedTags: [],
    ...overrides,
  };
}

type NewTripCreate = (input: { name: string; tripId?: string }) => Promise<ApiResult<{ tripId: string }>>;

function renderWizard(overrides: { createTrip?: NewTripCreate; onImportFile?: () => void } = {}) {
  // The CLIENT mints the id (KI-2026-09-12-e), so the mock echoes what it sent.
  const createTrip = vi.fn<NewTripCreate>();
  createTrip.mockImplementation(overrides.createTrip ?? (async (input) => ({ ok: true, value: { tripId: input.tripId ?? "trip-1" } })));
  const dispatch = vi
    .fn<(command: BoardCommand) => Promise<ApiResult<CommandOutcome>>>()
    .mockResolvedValue({ ok: true, value: {} as CommandOutcome });
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <NewTripWizard
      open
      onOpenChange={onOpenChange}
      createTrip={createTrip}
      dispatch={dispatch}
      onCreated={onCreated}
      {...(overrides.onImportFile === undefined ? {} : { onImportFile: overrides.onImportFile })}
    />,
  );
  return { createTrip, dispatch, onOpenChange, onCreated };
}

const nextButton = () => screen.getByRole("button", { name: /^(Next|Review|Back to review)$/ });

/** Search Where and pick the result whose name starts with `name`. */
async function pickWhere(typed: string, name: RegExp) {
  await user.type(screen.getByLabelText("Where are you going?"), typed);
  await user.click(await screen.findByRole("button", { name }));
}

/** All five pages, dated, ending on Review. */
async function walkToReview() {
  await pickWhere("Lis", /^Lisbon/);
  await user.click(nextButton());
  await user.click(screen.getByRole("radio", { name: "Yes, pick a day" }));
  fireEvent.change(screen.getByLabelText("Yes, pick a day", { selector: "input" }), { target: { value: "2027-04-10" } });
  await user.click(nextButton());
  await user.click(screen.getByRole("radio", { name: "A week" }));
  await user.click(nextButton());
  await user.click(screen.getByRole("radio", { name: "Slow" }));
  await user.click(nextButton());
  await user.click(screen.getByRole("checkbox", { name: "Food" }));
  await user.click(screen.getByRole("checkbox", { name: "Museum" }));
  await user.click(nextButton());
}

/**
 * `:focus` asked of the element a query found, as `SnapshotList.test.tsx`
 * does: the test-quality wall bans reading `document.activeElement`.
 */
const hasFocus = (element: HTMLElement) => element.matches(":focus");

/** What Review says for a row. */
const reviewed = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling?.textContent;

describe("NewTripWizard — the pages", () => {
  it("opens on Where, step one of five, with Cass and nothing to move on with yet", () => {
    renderWizard();
    expect(screen.getByRole("progressbar", { name: "New trip progress" }).getAttribute("aria-valuenow")).toBe("1");
    expect(screen.getByText("Step 1 of 5")).not.toBeNull();
    expect(screen.getByText(/^Hi, it’s Cass\./)).not.toBeNull();
    expect(nextButton().hasAttribute("disabled")).toBe(true);
  });

  // The gate's first box, at the layer that renders the flow: what is typed
  // finds places and is never one. Only a picked result moves Where on.
  it("commits Where only from a search result, never from what was typed", async () => {
    const { createTrip } = renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Nowhere Bay");
    expect(await screen.findByText("No place matches “Nowhere Bay”.")).not.toBeNull();
    await user.keyboard("{Enter}");
    expect(nextButton().hasAttribute("disabled"), "typed words moved Where on").toBe(true);
    // *create an empty one* does not take the typed words as a name either.
    await user.click(screen.getByRole("button", { name: "create an empty one" }));
    await waitFor(() => expect(createTrip).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Untitled trip" });
  });

  it("asks for the world, and labels a library place as having Playbooks", async () => {
    renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Po");
    expect(await screen.findByRole("button", { name: "Porto, Porto, Portugal" })).not.toBeNull();
    expect(library.places).toHaveBeenLastCalledWith("Po", { world: true });
    await user.clear(screen.getByLabelText("Where are you going?"));
    await user.type(screen.getByLabelText("Where are you going?"), "Lis");
    expect(await screen.findByRole("button", { name: "Lisbon, has Playbooks" })).not.toBeNull();
  });

  // A picked result's list unmounts with the button that had focus, which
  // would drop a keyboard reader on the page's body.
  it("hands focus to Next once a result is picked", async () => {
    renderWizard();
    await pickWhere("Lis", /^Lisbon/);
    expect(hasFocus(nextButton())).toBe(true);
  });

  it("takes the first result on Enter", async () => {
    renderWizard();
    await user.type(screen.getByLabelText("Where are you going?"), "Lis");
    await screen.findByRole("button", { name: /^Lisbon/ });
    await user.keyboard("{Enter}");
    expect(nextButton().hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("new-trip-decided").textContent).toBe("Lisbon");
  });

  // No free text anywhere (M56 scope 2): the one field in the flow is Where's
  // search, and every other page answers with a pick.
  it("has no text field on any page but Where's search", async () => {
    renderWizard();
    const fields: string[] = [];
    const record = (page: string) =>
      fields.push(`${page}: ${screen.queryAllByRole("textbox").length} text, ${screen.queryAllByRole("searchbox").length} search`);
    record("where");
    await pickWhere("Lis", /^Lisbon/);
    await user.click(nextButton());
    record("start");
    await user.click(screen.getByRole("radio", { name: "Not yet" }));
    await user.click(nextButton());
    record("length");
    await user.click(screen.getByRole("radio", { name: "Another length" }));
    record("length, counter");
    await user.click(nextButton());
    record("pace");
    await user.click(screen.getByRole("radio", { name: "Balanced" }));
    await user.click(nextButton());
    record("about");
    await user.click(nextButton());
    record("review");
    expect(fields).toEqual([
      "where: 0 text, 1 search",
      "start: 0 text, 0 search",
      "length: 0 text, 0 search",
      "length, counter: 0 text, 0 search",
      "pace: 0 text, 0 search",
      "about: 0 text, 0 search",
      "review: 0 text, 0 search",
    ]);
  });

  it("says what is decided so far under the step", async () => {
    renderWizard();
    await pickWhere("Lis", /^Lisbon/);
    await user.click(nextButton());
    await user.click(screen.getByRole("radio", { name: "Not yet" }));
    await user.click(nextButton());
    await user.click(screen.getByRole("radio", { name: "Another length" }));
    await user.click(screen.getByRole("button", { name: "More days" }));
    expect(screen.getByText("Step 3 of 5")).not.toBeNull();
    expect(screen.getByTestId("new-trip-decided").textContent).toBe("Lisbon · Not yet · 8 days");
  });

  it("goes back a page with every answer kept", async () => {
    renderWizard();
    await pickWhere("Lis", /^Lisbon/);
    await user.click(nextButton());
    await user.click(screen.getByRole("radio", { name: "Not yet" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 5")).not.toBeNull();
    await user.click(nextButton());
    expect(screen.getByRole("radio", { name: "Not yet" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("NewTripWizard — Review", () => {
  it("lists every answer, and creates the trip with all of them", async () => {
    const { createTrip, dispatch, onCreated } = renderWizard();
    await walkToReview();
    expect(reviewed("Where")).toBe("Lisbon");
    expect(reviewed("Start date")).toBe("Apr 10, 2027");
    expect(reviewed("How long")).toBe("A week");
    expect(reviewed("Pace")).toBe("Slow");
    expect(reviewed("What it is about")).toBe("Food, Museum");

    await user.click(screen.getByRole("button", { name: "Just create it" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createTrip.mock.calls[0]![0]).toMatchObject({ name: "Lisbon" });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SetTripDates", startDate: "2027-04-10", endDate: "2027-04-16" }),
    );
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripStyle", pace: "slow", tags: ["meal", "museum"] }));
    expect(onCreated).toHaveBeenCalledWith(createTrip.mock.calls[0]![0].tripId, { navigate: true });
  });

  it("opens a page from Change and comes back to Review", async () => {
    renderWizard();
    await walkToReview();
    await user.click(screen.getByRole("button", { name: "Change pace" }));
    // Prefilled with what was picked.
    expect(screen.getByRole("radio", { name: "Slow" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Packed" }));
    await user.click(screen.getByRole("button", { name: "Back to review" }));
    expect(reviewed("Pace")).toBe("Packed");
  });

  // Review, Change and Back to review each unmount the button that was pressed.
  it("keeps keyboard focus on the flow through Review, Change and Back to review", async () => {
    renderWizard();
    await walkToReview();
    expect(hasFocus(screen.getByTestId("new-trip-page")), "Review").toBe(true);
    await user.click(screen.getByRole("button", { name: "Change pace" }));
    expect(hasFocus(screen.getByRole("radio", { name: "Slow" })), "the changed page").toBe(true);
    await user.click(screen.getByRole("radio", { name: "Packed" }));
    await user.click(screen.getByRole("button", { name: "Back to review" }));
    expect(hasFocus(screen.getByRole("button", { name: "Change pace" })), "back on Review").toBe(true);
  });

  // The gate's re-walk box: a new destination re-asks every later page, each
  // already holding its answer, under *Destination changed*.
  it("re-walks the later pages, prefilled, when Where changes", async () => {
    renderWizard();
    await walkToReview();
    await user.click(screen.getByRole("button", { name: "Change where" }));
    await pickWhere("Por", /^Porto/);
    await user.click(nextButton());

    const walked: string[] = [];
    const checked = (role: "radio" | "checkbox") =>
      screen
        .queryAllByRole(role)
        .filter((each) => each.getAttribute("aria-checked") === "true")
        .map((each) => each.textContent)
        .join("+");
    for (const role of ["radio", "radio", "radio", "checkbox"] as const) {
      walked.push(`${screen.getByText(/^Step \d of 5$/).textContent}: ${checked(role)}, ${screen.queryByText("Destination changed") === null ? "-" : "changed"}`);
      await user.click(nextButton());
    }
    expect(walked).toEqual([
      "Step 2 of 5: Yes, pick a day, changed",
      "Step 3 of 5: A week7 days, changed",
      "Step 4 of 5: SlowFewer stops, longer lunches, changed",
      "Step 5 of 5: Food+Museum, changed",
    ]);
    expect(reviewed("Where")).toBe("Porto");
    expect(screen.queryByText("Destination changed")).toBeNull();
  });

  it("gives a free account Create trip and one quiet locked line", async () => {
    aiEntitled.value = false;
    renderWizard();
    await walkToReview();
    expect(screen.getByRole("button", { name: "Create trip" })).not.toBeNull();
    expect(screen.getByText(/Planning it with AI is part of Plus\./)).not.toBeNull();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
    expect(screen.queryByRole("button", { name: "Plan with AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Just create it" })).toBeNull();
  });

  it("gives an entitled account Just create it and Plan with AI", async () => {
    aiEntitled.value = true;
    const { onCreated } = renderWizard();
    await walkToReview();
    expect(screen.getByRole("button", { name: "Just create it" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Create trip" })).toBeNull();
    expect(screen.queryByText(/part of Plus/)).toBeNull();
    // Plan with AI makes the trip and goes to it (the rail is part 6's).
    await user.click(screen.getByRole("button", { name: "Plan with AI" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.any(String), { navigate: true }));
  });

  it("takes the paid branch while the entitlement is unknown", async () => {
    aiEntitled.value = null;
    renderWizard();
    await walkToReview();
    expect(screen.getByRole("button", { name: "Plan with AI" })).not.toBeNull();
    expect(screen.queryByText(/part of Plus/)).toBeNull();
  });

  // A failed create says so and keeps everything for the retry (CodeRabbit,
  // PR 188): no "is created", no navigation.
  it("keeps the sheet and says why when the create fails", async () => {
    const { onCreated, onOpenChange } = renderWizard({
      createTrip: async () => ({ ok: false, error: { status: 0, message: "Network is down" } }),
    });
    await walkToReview();
    await user.click(screen.getByRole("button", { name: "Just create it" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Network is down");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Just create it" })).not.toBeNull();
  });

  // After a partial failure the trip exists under its first name, and Review
  // still offers Change: a new Where has to reach that trip, not just Review.
  it("renames the trip it already made when Where changes before a retry", async () => {
    const { createTrip, dispatch } = renderWizard();
    let datesFailed = false;
    dispatch.mockImplementation(async (command) => {
      if (command.type === "SetTripDates" && !datesFailed) {
        datesFailed = true;
        return { ok: false, error: { status: 500, message: "Dates failed" } };
      }
      return { ok: true, value: {} as CommandOutcome };
    });
    await walkToReview();
    await user.click(screen.getByRole("button", { name: "Just create it" }));
    await screen.findByRole("alert");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SetTripName" }));

    await user.click(screen.getByRole("button", { name: "Change where" }));
    await pickWhere("Por", /^Porto/);
    for (let page = 0; page < 5; page++) await user.click(nextButton());
    await user.click(screen.getByRole("button", { name: "Just create it" }));
    const tripId = createTrip.mock.calls[0]![0].tripId;
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "SetTripName", tripId, name: "Porto" }));
    expect(createTrip).toHaveBeenCalledTimes(1);
  });

  // §30.2's property, over the whole walk: reads to find places and days,
  // and no write until a create is pressed.
  it("sends nothing but searches while the pages are being answered", async () => {
    const { createTrip, dispatch } = renderWizard();
    await walkToReview();
    expect(createTrip).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(library.insert).not.toHaveBeenCalled();
    expect(library.search).toHaveBeenCalledExactlyOnceWith({ cities: ["Lisbon"], sort: "most-added" });
  });
});

// D9: the Playbook-day turn the five pages dropped, as an optional card on Review.
describe("NewTripWizard — published days on Review", () => {
  const TRAM = "11111111-1111-4111-8111-111111111111";
  const ALFAMA = "22222222-2222-4222-8222-222222222222";
  const OFFERED = [
    published({ savedDayId: ALFAMA, name: "Alfama at dusk", adds: 3, dayCount: 2 }),
    published({ savedDayId: TRAM, name: "Tram 28 morning", adds: 12 }),
    published({ savedDayId: "33333333-3333-4333-8333-333333333333", name: "Mine", adds: 50, isMine: true }),
  ];

  it("offers the most-added days for the place, and none of the reader's own", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    renderWizard();
    await walkToReview();
    const cards = within(screen.getByRole("group", { name: "Popular days" })).getAllByRole("button");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Tram 28 morningAdded to 12 trips · 1 day · by Mei L.Start from this",
      "Alfama at duskAdded to 3 trips · 2 days · by Mei L.Start from this",
    ]);
  });

  it("asks nothing for a place with no Playbooks", async () => {
    renderWizard();
    await pickWhere("Por", /^Porto/);
    expect(library.search).not.toHaveBeenCalled();
  });

  it("puts a chosen day in the trip once it exists", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    const { createTrip, onCreated } = renderWizard();
    await walkToReview();
    await user.click(screen.getByRole("button", { name: /^Tram 28 morning/ }));
    expect(screen.getByRole("button", { name: /^Tram 28 morning/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Just create it" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(library.insert).toHaveBeenCalledExactlyOnceWith(createTrip.mock.calls[0]![0].tripId, TRAM);
  });

  // The trip stands; a day that did not land is one to add from Playbooks,
  // and the sheet stays up long enough to say which.
  it("keeps the trip and says so when a chosen day cannot be added", async () => {
    library.search.mockResolvedValue(discover(OFFERED));
    library.insert.mockResolvedValue({ ok: false, error: { status: 404, message: "gone" } });
    const { onCreated } = renderWizard();
    await walkToReview();
    await user.click(screen.getByRole("button", { name: /^Alfama at dusk/ }));
    await user.click(screen.getByRole("button", { name: "Just create it" }));
    expect(await screen.findByText(/Alfama at dusk could not be added — it is still in Playbooks\./)).not.toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open the trip" }));
    expect(onCreated).toHaveBeenCalledWith(expect.any(String), { navigate: true });
  });
});

describe("NewTripWizard — the quiet row", () => {
  // M27 D4: live before anything is picked, and `CreateTrip.name` is `min(1)`.
  it("names an empty trip after the picked place, or Untitled trip, and sends nothing else", async () => {
    const { createTrip, dispatch, onCreated } = renderWizard();
    await pickWhere("Lis", /^Lisbon/);
    await user.click(screen.getByRole("button", { name: "create an empty one" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const sent = createTrip.mock.calls[0]![0];
    expect(sent).toMatchObject({ name: "Lisbon" });
    // The client mints the id (KI-2026-09-12-e), and hands back the one it sent.
    expect(sent.tripId).toMatch(/^[0-9a-f-]{36}$/);
    expect(onCreated).toHaveBeenCalledWith(sent.tripId, { navigate: false });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("goes to Discover from start from a Playbook, closing the sheet", async () => {
    const { onOpenChange } = renderWizard();
    const link = screen.getByRole("link", { name: "start from a Playbook" });
    expect(link.getAttribute("href")).toBe("/playbooks");
    await user.click(link);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Closed, THEN the page's picker, in one click: a picker opened under a
  // still-open modal sheet would open from behind its overlay.
  it("closes the sheet and hands import a trip file to the page, in that order", async () => {
    const calls: string[] = [];
    const onImportFile = vi.fn(() => calls.push("import"));
    const { onOpenChange } = renderWizard({ onImportFile });
    onOpenChange.mockImplementation((open: boolean) => calls.push(`open:${String(open)}`));
    await user.click(screen.getByRole("button", { name: "import a trip file" }));
    expect(calls).toEqual(["open:false", "import"]);
  });

  it("offers no import link when the page has no picker to hand it to", () => {
    renderWizard();
    expect(screen.queryByRole("button", { name: "import a trip file" })).toBeNull();
  });
});
