import { expect, type Locator, type Page } from "@playwright/test";
import type { Location } from "@tc/contracts";
import { commandsFor, type CommandsForOverrides } from "@tc/factories";
import { E2E_SUPER_CODE } from "./admission";

// @atlaskit/pragmatic-drag-and-drop is built on the browser's native HTML5
// Drag and Drop API. Locator.dragTo() drives it with a single mouse-down /
// one-jump mouse-move / mouse-up sequence, and relies on Chromium to
// translate that into dragstart/dragover/drop — a translation that requires
// recognizing drag intent from pointer movement within a timing window.
// Under CI's single-worker, resource-constrained runs that window is
// sometimes missed and the drop silently never registers (never reproduced
// locally, where the window is comfortably met). Firing the mouse sequence
// ourselves with several intermediate move steps gives Chromium's native
// drag recognition enough events to register reliably.
//
// `at` is where on the target to let go, in px from its top-left corner, like
// Playwright's own `position`; the default is its centre. A day's river reads
// the drop's height as a time (M29), so a drag meant to land at a particular
// time says where.
export async function dragCardTo(source: Locator, target: Locator, at?: { x: number; y: number }): Promise<void> {
  // The board refetches and re-lays-out after every command (a new day pushes
  // the "One more day?" column along, a new card grows its column), so a drag fired
  // immediately after a prior mutation can read a box that's about to move.
  // waitFor({ state: "visible" }) plus scrollIntoViewIfNeeded's own
  // actionability checks (Playwright waits for the element to stop moving
  // before scrolling to it) are what stand in for the wall-clock sleep this
  // used to need — see KI-13's "no sleeps" principle.
  await source.waitFor({ state: "visible" });
  await target.waitFor({ state: "visible" });
  await source.scrollIntoViewIfNeeded();

  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error("dragCardTo: source has no bounding box");

  const page = source.page();
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // A small initial move off the press point is what Chromium treats as
  // "drag intent" and turns into `dragstart` — without it, a single long jump
  // can be classified as a click and the whole HTML5 drag never begins (this
  // is the recognition window the taller time-windowed cards + wrapped grid
  // make easier to miss).
  await page.mouse.move(sx + 6, sy + 6, { steps: 3 });

  // KI-21's traced root cause: a target whose box sat (partly) outside the
  // viewport — a day column pushed below the fold — was left to be reached
  // during the drag within a hand-rolled 5s polling budget, which sometimes
  // ran out. KI-21 put this down to drag-triggered auto-scroll (Board.tsx's
  // autoScrollWindowForElements) being slow on a loaded machine. In fact that
  // auto-scroll could not have run before 2026-09-25: two copies of the pdnd
  // core meant it never saw a drag start (KI-2026-09-25-g, inferred from the
  // mechanism, not separately tested), so whatever let
  // those drags sometimes arrive, it was not pdnd. The fix below does not
  // depend on auto-scroll at all. Scrolling the target into view *after the
  // drag has already started* (rather than before, which could scroll a distant
  // source out of view before mouse.down ever fires at it) removes that
  // race entirely instead of widening the window: by the time the mouse
  // moves toward the target, it's already on screen. Re-read the target's
  // box after scrolling — its viewport-relative coordinates change with it.
  await target.scrollIntoViewIfNeeded();
  // A point on a target taller than the viewport can still be off screen, or
  // under the sticky header, after that: bring the point itself to the middle.
  if (at !== undefined) await centreOnPoint(target, at.y);
  const targetBox = await target.boundingBox();
  if (!targetBox) throw new Error("dragCardTo: target has no bounding box");
  const tx = targetBox.x + (at?.x ?? targetBox.width / 2);
  const ty = targetBox.y + (at?.y ?? targetBox.height / 2);

  await page.mouse.move(tx, ty, { steps: 25 });
  if (at !== undefined) await reaim(target, at);
  await page.mouse.up();

  // No wait here for the drop to "register": the caller asserts the moved
  // card is where it expects (a web-first assertion, e.g. `toBeVisible()`),
  // and Playwright's own auto-waiting retries that until it's true or the
  // test's timeout expires. A helper-internal poll can only guess when the
  // drop landed; the app's own rendered state is the real signal.
}

/**
 * Scrolls the window so the point `y` px down `target` sits mid-viewport.
 *
 * `scrollIntoViewIfNeeded` alone can leave a point on a tall target off
 * screen or under the sticky header, and a point near either edge is inside
 * the drag's auto-scroll hitbox (pdnd's, up to 180px from the viewport edge;
 * Board.tsx `autoScrollWindowForElements`), where the page keeps moving under
 * a held pointer for as long as it stays there.
 */
export async function centreOnPoint(target: Locator, y: number): Promise<void> {
  await target.evaluate((el, dy) => window.scrollBy(0, el.getBoundingClientRect().top + dy - window.innerHeight / 2), y);
}

/**
 * Moves a held pointer back onto the point `at` on `target` until it stays
 * there. A drag that starts or passes near a viewport edge auto-scrolls the
 * page on its way (the rack sits along the bottom edge), by an amount that
 * depends on how long it spent there — so a point read before the move can be
 * a quarter hour, or an hour, off the one under the pointer when it arrives
 * (seen on `test:e2e:ci-like`: the same drop read 2:15 pm, then 3 pm). The
 * pointer, once on a mid-viewport point, is outside the hitbox and the page
 * stops; each pass re-reads the target and closes the gap.
 */
export async function reaim(target: Locator, at: { x: number; y: number }): Promise<void> {
  const page = target.page();
  for (let pass = 0; pass < 5; pass++) {
    const box = await target.boundingBox();
    if (!box) throw new Error("reaim: target has no bounding box");
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 3 });
    const after = await page.evaluate(() => window.scrollY);
    if (after === before) return;
  }
}

/**
 * Signs a dev user in and leaves them on Home.
 *
 * Goes through `/signup` rather than `/signin`, and presents the super code,
 * because M11a's gate refuses anyone with no `users` row and no credential —
 * and against a fresh database every dev user this suite uses is exactly that
 * person. The build plan's decision 3 routes dev login through the gate rather
 * than exempting it, so this is the admission path, not a workaround for one.
 * The invite-code field lives on `/signup` only (AuthScreen's `mode`), which
 * is why the landing-page "Sign in" walk moved here; `smoke.spec.ts` still
 * covers the front door from `/` and `m11a-invite-gate.spec.ts` covers
 * `/signin` for someone who already has a row.
 */
export async function signInAsDevUser(page: Page, username: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  // eslint-disable-next-line playwright/prefer-locator -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
  await page.fill('input[name="username"]', username);
  // Wait for the post-sign-in page's first authenticated /api/trips fetch —
  // it only fires after React hydrates, so the form's onSubmit is attached.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

/**
 * Creates a trip with `dayCount` days, each carrying one located activity, via
 * the app's own command API. `page.request` shares the browser context's
 * cookies, so this runs as the already-signed-in dev user.
 *
 * The map rail only gears once its content overflows its viewport, which needs
 * more days than are practical to build through the UI. A thin wrapper over
 * `@tc/factories`'s `commandsFor("mappedTrip", ...)` — the same command
 * vocabulary unit tests, other e2e specs, and `db:seed` all share (ADR-020).
 */
export async function createMappedTrip(
  page: Page,
  name: string,
  dayCount: number,
  overrides: CommandsForOverrides = {},
): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const response = await page.request.post(path, { data: body });
    if (!response.ok()) {
      throw new Error(`POST ${path} -> ${response.status()}: ${await response.text()}`);
    }
    return response.json();
  };

  const { tripId } = await post("/api/trips", { name });
  for (const command of commandsFor("mappedTrip", tripId, { ...overrides, dayCount })) {
    await post(`/api/trips/${tripId}/commands`, command);
  }

  return tripId as string;
}

// A 20-day trip in nine stays, one of them a return to Tokyo — the shape of a
// real two-and-a-half-week trip, and longer than the ~14-day preview trip the
// trip strip was reported on (PR #221). Runs of one day are in it on purpose:
// they are the narrowest thing the strip has to label.
const STAY_LENGTHS: readonly (readonly [string, number])[] = [
  ["Tokyo", 4], ["Hakone", 1], ["Kyoto", 4], ["Nara", 1], ["Osaka", 3],
  ["Hiroshima", 2], ["Miyajima", 1], ["Kanazawa", 2], ["Tokyo", 2],
];
// Coordinates so the stops are what the board gets from a real geocode; their
// values mean nothing to the strip, which reads only `city`.
export const TWENTY_DAYS_IN_JAPAN: readonly Location[] = STAY_LENGTHS.flatMap(([city, days]) =>
  Array.from({ length: days }, (_, i) => ({ name: `${city} stop ${i + 1}`, city, lat: 35, lng: 135 + i * 0.1, countryCode: "JP" })),
);

/**
 * How far the trip strip reaches past its own box, in px: the larger of its
 * scroll overflow and its last day cell's overhang. `<= 0` is "fits".
 *
 * Both, because they fail differently: `overflow-x-auto` turns overflow into
 * a scrollbar (scrollWidth), and a cell pushed out of an `overflow-visible`
 * box shows up only as geometry. jsdom has no layout, so this is the only
 * layer that can say the strip fits (Mitchell on PR #221: "fit without having
 * to scroll").
 */
export async function stripOverhang(strip: Locator): Promise<number> {
  return strip.evaluate((el) => {
    const cells = el.querySelectorAll('[data-testid="trip-strip-day"]');
    const last = cells[cells.length - 1];
    if (last === undefined) throw new Error("the strip has no day cells, so this measures nothing");
    // Rounded: twenty equal fractions of a column land on sub-pixel edges, and
    // the first green run measured the last one 0.015625px (1/64) past its box.
    // That is layout rounding, not a scroll — `scrollWidth` is whole pixels.
    const overhang = Math.round(last.getBoundingClientRect().right - el.getBoundingClientRect().right);
    return Math.max(el.scrollWidth - el.clientWidth, overhang);
  });
}

/**
 * Opens the History popover, where undo/redo now live.
 *
 * The two buttons left the trip header in PR #55 (design rules pass,
 * 2026-08-25: "the next/previous history button was moved into the history
 * dropdown"). Popover content only exists while the popover is open, so every
 * spec that clicks Undo/Redo has to come through here first.
 *
 * `exact: true` on the trigger is load-bearing, not tidiness: the trip title
 * button's accessible name now ends in "— Trip settings" and *starts* with the
 * trip name, so a spec whose trip is called "RackHistory …"
 * (m10-unscheduled-rack) makes a loose /history/i match ambiguous and trips
 * strict mode. Same trap m10's own comment already documents for /undo/i.
 *
 * Idempotent: a no-op when the popover is already open, so two undos in a row
 * don't toggle it shut.
 */
export async function openHistory(page: Page): Promise<void> {
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  if (await undo.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "History", exact: true }).click();
  await undo.waitFor({ state: "visible" });
}

/**
 * Reports whether the page got a working maplibre tile-decoding worker.
 *
 * Why this exists. Bump #158 took maplibre 5 -> 6, which moved the worker from
 * an inlined blob to a separate module worker resolved at runtime from
 * `import.meta.url`. Nothing a bundler can rewrite, so in the built app that
 * expression yielded an EMPTY url, `new Worker("")` resolved against the
 * document, and the browser was handed the page HTML as a module script and
 * refused it on MIME type. The map then drew its chrome — rail, legend, focus
 * card, every locator the Map specs assert on — over a basemap that never
 * decoded a tile. The whole suite stayed green and it reached production.
 *
 * The assertion is on the POSITIVE outcome — a worker script actually served
 * as JavaScript — and not on the absence of an error, for a reason worth
 * keeping: when this was checked by removing the fix and running it, the
 * browser's "Failed to load module script" never reached `page.on("console")`
 * at all. That message belongs to the worker context, not the page, so a
 * console-watching guard sits there reading clean while the map is dead. What
 * the broken build does NOT do is ask for the worker we serve, and that is
 * what this watches.
 *
 * Poll `outcome`: it returns as soon as the worker responds on the happy path,
 * and otherwise carries its own explanation instead of a bare timeout.
 */
export function watchMapWorker(page: Page): { outcome: () => string } {
  let state =
    "no request for a maplibre worker script was ever made — its url did not " +
    "resolve to the copy we serve (see watchMapWorker in e2e/helpers.ts)";
  const settled = () => state === "loaded";

  page.on("response", (response) => {
    if (!response.url().includes("maplibre-gl-worker")) return;
    const contentType = response.headers()["content-type"] ?? "(none)";
    state =
      response.status() === 200 && /javascript/.test(contentType)
        ? "loaded"
        : `worker served ${response.status()} as ${contentType} from ${response.url()}`;
  });

  // The other shape this failure can take: the worker IS requested and comes
  // back as something that is not JavaScript. Recorded only while nothing has
  // loaded yet, so an unrelated late error cannot un-pass a healthy map.
  page.on("console", (message) => {
    if (settled() || message.type() !== "error") return;
    if (/failed to load module script|failed to fetch worker/i.test(message.text())) {
      state = `worker load error: ${message.text()}`;
    }
  });
  page.on("pageerror", (error) => {
    if (settled()) return;
    state = `uncaught page error: ${error.message}`;
  });

  return { outcome: () => state };
}

/**
 * Opens the desktop assistant rail from its collapsed launcher.
 *
 * **The launcher is not called "Assistant" any more.** SPEC §28 replaced the
 * 56px brand circle with a 92×44 bar reading `Ask` — "a square brand tile
 * carrying the wordmark's own glyph read as a logo, not a control" — so every
 * `getByRole("button", { name: "Assistant" })` in this suite went from clicking
 * a control to waiting 30 seconds for one. Five walks across two specs died
 * that way in the first full lane after the 2026-09-12 design sync.
 *
 * By testid rather than by its new name, and that is not laziness about roles:
 * the rail's own SEND button is also called "Ask" (m10-simulated-ai types a
 * question and presses it), so a spec that names the launcher by text has a
 * second control with the same name one click later. `assistant-launcher` is
 * the handle `AssistantBubble` publishes for exactly this — see its comment on
 * why two controls legitimately share the word.
 */
export async function openAssistantRail(page: Page): Promise<void> {
  await page.getByTestId("assistant-launcher").click();
  await expect(page.getByRole("complementary", { name: "Assistant" })).toBeVisible();
}

/**
 * Moves a walk that has just entered a trip onto the Plan view.
 *
 * **A bare `/trips/<id>` does not land on the board any more.** SPEC §24 made
 * Overview the default of four views (Overview, Plan, Calendar, Map) and the
 * one that does not edit, so every walk that arrived by clicking a trip's link
 * and then reached for a board control — "Add a day", a day column, an activity
 * card, "Keep day 1" — waited 30 seconds for something one tab away. That was
 * the single largest class of breakage in the 2026-09-12 design sync, and it is
 * invisible to typecheck, to lint and to review.
 *
 * A tab click rather than `?view=Plan` on the `goto`, deliberately: a walk that
 * got here by pressing a link in the trips list is standing where a person
 * stands, and what a person does next is press Plan. Specs that navigate by URL
 * in the first place should put `?view=Plan` in the URL instead — both are
 * honest, and neither is a workaround for the other.
 *
 * Asserting the URL, not just the click: `view` is what `LensRouter.resolveView`
 * reads, and a click that changed the highlighted tab without writing the query
 * would leave the next reload back on Overview.
 */
export async function openPlan(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Plan" }).click();
  await expect(page).toHaveURL(/view=Plan/);
}

/**
 * **Create an empty trip through the New-trip sheet, from the home page.**
 *
 * One seam, where there were fourteen. `getByRole("button", { name: "New trip" })`
 * → `getByLabel("Trip name")` → `"Create empty"` was inlined across nine spec
 * files, none of which is about the sheet — every one of them just needs a trip
 * to exist before it can test something else.
 *
 * That sequence has since stopped working, exactly as expected: SPEC §30.1
 * turned the sheet into four conversational turns and the field called "Trip
 * name" went away with the form. Because the sequence moved here FIRST — in its
 * own commit, against the wizard as it then stood, with the suite green either
 * side — the rename below is a one-line edit rather than fourteen.
 *
 * Leaves the browser on the home page with the new trip's link present, which
 * is where every caller already expected to be. It deliberately does NOT open
 * the trip: about half the callers go somewhere else first, and a helper that
 * navigated would have to be un-navigated by them.
 */
export async function createEmptyTripViaWizard(page: Page, tripName: string): Promise<void> {
  await page.getByRole("button", { name: "New trip" }).click();
  // The composer's accessible name is the QUESTION being asked, not "Trip
  // name" — the sheet is four conversational turns now (SPEC §30.1). This one
  // rename is the whole reason the sequence moved in here first.
  await page.getByLabel("Where are you going?").fill(tripName);
  // SPEC §35.2: *Create empty* stopped being a footer button and became the
  // quiet row's *create an empty one*.
  await page.getByRole("button", { name: "create an empty one" }).click();
  // **The new trip lands as the hero — usually.** The list is newest-first and
  // since §35.2 the hero is left out of *Other trips*, so a new trip has no
  // card. But every spec file signs in as the same `alice` and files run in
  // parallel, so another worker's trip created a moment later takes the hero
  // and leaves this one as a card. The trip's NAME is a link to it in either
  // place (the hero's heading is wrapped in one, like a card's), which is what
  // every caller clicks next — so that is what this waits on. A hero-heading
  // assertion here would fail whenever that race went the other way.
  await expect(page.getByRole("link", { name: tripName })).toBeVisible();
}

/**
 * **Where a trip is drawn on Home: its hero, or its card.** Since SPEC §35.2 a
 * trip is one or the other, never both, and which depends on what else the
 * shared e2e account created first — see `createEmptyTripViaWizard`.
 */
export function homeTrip(page: Page, tripName: string): Locator {
  return page
    .getByTestId("trip-card")
    .or(page.getByTestId("next-trip-hero"))
    .filter({ hasText: tripName });
}

/**
 * Open `/account` from the header's avatar menu and, optionally, land on a tab.
 *
 * **Through the menu rather than `page.goto("/account")`**, because the menu
 * entry is the only way a person reaches this page and a spec that navigates
 * directly stops proving the entry point exists. That is what happened to
 * "Your account" for four milestones: it was absent from the menu while every
 * test that needed account settings drove something else.
 *
 * Account was a modal Sheet until M26 link 1 (SPEC §34.4), so specs that used
 * to wait on `getByRole("heading", { name: "Your account" })` or scope to
 * `getByRole("dialog")` wait on the page's own `Account` heading now. The tabs
 * are real URLs (`?tab=`), so a tab click is a navigation, not a state flip.
 *
 * **`tokens` is not a tab since M27** (SPEC §35.4): it is reached from Profile's
 * *API tokens →* line, so that is what this drives — the line is the only way
 * a person gets there, for the same reason the menu is driven above.
 */
export async function openAccountPage(page: Page, tab?: "profile" | "plan" | "tokens"): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("link", { name: "Your account" }).click();
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  if (tab === undefined) return;
  if (tab === "tokens") {
    await page.getByRole("button", { name: "API tokens →" }).click();
    await expect(page.getByRole("heading", { name: "API tokens", level: 3 })).toBeVisible();
    return;
  }
  const label = { profile: "Profile", plan: "Plan & usage" }[tab];
  await page.getByRole("tab", { name: label }).click();
  await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
}

/** The account page's content, for a spec that used to scope to the Sheet's dialog. */
export function accountPanel(page: Page): Locator {
  return page.getByRole("tabpanel");
}
