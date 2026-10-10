import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { DEFAULT_TEMPLATES } from "@tc/pages";
import { JAPAN_TRAVELLERS } from "@tc/fixtures";
import { createEmptyTripViaWizard } from "./helpers";
import { e2eTripName } from "./tripNames";

// M30 — several notebooks, an itinerary Overview, and two link widgets.
//
// Mitchell, 2026-09-26: *"Maybe the issue is trying to make the overview do
// everything, and instead we have several notebooks, with different
// purposes. A great feature we are missing is we should have a Link widget
// that lets you link to other notebooks, or pages in the website"*.
//
// Walked the way a person walks it: a new trip, its four notebooks, the
// Overview's cards to the other three, then an internal link inserted through
// the rail's search-as-you-type picker and followed, and an external link
// typed in. Every write is followed by a reload of what it wrote.

async function openNotebookIndex(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Notebooks" }).click();
  await page.getByRole("link", { name: /Browse all notebooks/ }).click();
  await expect(page.getByRole("heading", { name: "Notebooks", exact: true, level: 2 })).toBeVisible();
}

// The edit session writes once, when it ends (ADR-036).
async function finishEditing(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/trips\/[^/]+\/pages\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH" && r.ok(),
    ),
    page.getByRole("button", { name: "Done editing" }).click(),
  ]);
}

// A caret on a line of its own under the page's first heading, then a row from
// the rail — `m14-notebook-widgets.spec.ts`' two-beat insert.
async function insertFromRail(page: Page, name: RegExp, search: string): Promise<void> {
  // **Clicked until the settings let go**, and that is a known defect rather
  // than patience: right after a link widget is bound from its settings, the
  // first click into the page sometimes leaves those settings open — 3 of 8
  // repeat runs on 2026-09-26, always here, never elsewhere in the walk.
  // KI-2026-09-26-a has the evidence; a person clicks again, and so does this.
  await expect(async () => {
    await page.locator(".tc-page-editor h2").first().click();
    await expect(page.getByTestId("widget-settings")).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("widget-settings")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search widgets" }).fill(search);
  await page.getByRole("complementary").getByRole("list").getByRole("button", { name }).click();
  await expect(page.getByTestId("widget-settings")).toBeVisible();
}

test("a new trip comes with four notebooks, and the Overview links to the other three", async ({ page }) => {
  const tripName = e2eTripName("Porto");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();

  // -- the four, in order, each described by its own first line --
  await openNotebookIndex(page);
  const mine = page.getByRole("region", { name: "Your notebooks" });
  await expect(mine.getByRole("listitem")).toHaveText(DEFAULT_TEMPLATES.map((t) => new RegExp(t.title)));
  await expect(mine.getByRole("listitem").filter({ hasText: "Money" })).toContainText("What the trip costs, day by day");

  // -- the Overview's cards find their notebooks, and go there --
  await mine.getByRole("link", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const moneyCard = page.getByRole("link", { name: /Money/ });
  await expect(moneyCard).toContainText("What the trip costs, day by day, against the budget.");
  await moneyCard.click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spend by day" })).toBeVisible();
});

// The Japan demo's Overview, which is where "reads like a professional
// itinerary" was asked about (Mitchell, 2026-09-26) — a new trip's is empty.
// Signed out, as the demo's visitors are. The whole walk is what a printed
// itinerary has: its covering note, the dates and route it heads with, then
// every day as a dated heading over timed lines, each stop's place under it
// and its standing beside it only when that is news, and last the way to the
// rest of the trip.
test.describe("the Japan demo's Overview", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("reads as an itinerary: a covering note, dates and route, then each day as a timed schedule", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");

    await expect(page.getByText(/^Here is your itinerary, day by day/)).toBeVisible();
    // Dated relative to today (ADR-030), so the dates are a shape; the route
    // is the fixture's own, in the order the trip reaches it.
    await expect(
      page.getByText(/^Dates: \w{3} \d{1,2}, \d{4} – \w{3} \d{1,2}, \d{4} · Route: Tokyo – .*Kyoto – Osaka/),
    ).toBeVisible();

    const days = page.getByRole("list", { name: "Day by day" }).getByTestId("itinerary-day");
    await expect(days).toHaveCount(14);
    await expect(days.first()).toContainText(/^Day 1\w+day, \w+ \d{1,2}Tokyo/);

    // Day 1, line by line: time and until, the stop, its standing only when
    // it is news (the flight is Travel, the hotel says nothing, the two
    // pending evenings are To book), and where it is.
    await expect(page.getByRole("list", { name: "Day 1", exact: true }).getByRole("listitem")).toHaveText([
      /^2:30 pm\s*until 4 pm\s*Land at Haneda\s*Travel\s*HND Terminal 3, Ōta, Tokyo/,
      /^5 pm\s*until 5:30 pm\s*Check in at Trunk Hotel\s*Trunk Hotel, Shibuya, Tokyo/,
      /^7 pm\s*until 8:30 pm\s*Dinner at Gonpachi\s*To book\s*Gonpachi Nishiazabu, Nishi-Azabu, Tokyo/,
      /^9 pm\s*until 10:30 pm\s*Nightcap at Bar Trench\s*To book\s*Bar Trench, Ebisu, Tokyo/,
    ]);

    // Last, the three other notebooks, each by its own first line.
    await expect(page.getByRole("heading", { name: "Also in this trip" })).toBeVisible();
    await expect(page.getByTestId("link-card")).toHaveText([/Before you go/, /Bookings/, /Money/]);
  });

  // Mitchell, 2026-09-27: *"'Also in this trip' - This section doesnt work at
  // all, i cant click them."* The cards drew as plain text for a visitor, whose
  // access is `/demo`'s and who has no notebook route to be sent to; they now
  // open the notebook in the Overview tab, on the demo's own path.
  test("an 'Also in this trip' card opens its notebook, still inside the read-only demo", async ({ page }) => {
    await page.goto("/demo");
    const money = page.getByTestId("link-card").filter({ hasText: "Money" });
    await expect(money).toHaveAttribute("href", /^\/demo\?/);
    await money.click();

    await expect(page).toHaveURL(/\/demo\?view=Overview&page=[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Spend by day" })).toBeVisible();
    // "Who owes what" (M19 part 2) names each traveller from the trip's access
    // read. Without it a member reads "Traveler 1", so a row led by each of the
    // demo's own travellers is the names reaching the widget. The roster is the
    // fixture's, not a literal here: it has already changed once (part 1).
    await expect(page.getByRole("heading", { name: "Who owes what" })).toBeVisible();
    for (const name of JAPAN_TRAVELLERS) await expect(page.getByRole("rowheader", { name, exact: true })).toBeVisible();
    await expect(page.getByText(/^Here is your itinerary, day by day/)).toHaveCount(0);
    // Read-only, as the Overview is: no Edit, and nothing on the page takes typing.
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);

    // Back by the letterhead's "Overview", then the keyboard's way in: a card
    // is a real link, so Tab reaches it and Enter follows it.
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText(/^Here is your itinerary, day by day/)).toBeVisible();
    // From a known focus on the card before it, so Tab — not `focus()` — is
    // what reaches Bookings (a <span> card would be skipped).
    await page.getByTestId("link-card").filter({ hasText: "Before you go" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("link-card").filter({ hasText: "Bookings" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/demo\?view=Overview&page=[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Still to book" })).toBeVisible();

    // Picking the Overview tab leaves the followed notebook, too.
    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/demo\?view=Overview$/);
    await expect(page.getByText(/^Here is your itinerary, day by day/)).toBeVisible();
  });
});

test("insert an internal link to Money and follow it; insert a link to a website", async ({ page }) => {
  const tripName = e2eTripName("Evora");
  await page.goto("/");
  await createEmptyTripViaWizard(page, tripName);
  await page.getByRole("link", { name: tripName }).click();
  await expect(page.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
  await openNotebookIndex(page);
  await page.getByRole("region", { name: "Your notebooks" }).getByRole("link", { name: /^Before you go/ }).click();
  await expect(page.getByRole("heading", { name: "Before you go", level: 1 })).toBeVisible();
  // The weather's answer lands after the page does; clicking into the page
  // before it has would be clicking a page that may yet move.
  await expect(page.getByText("loading weather")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit page" }).click();

  // -- internal: the picker opens on insert, searches what exists, stores the id --
  await insertFromRail(page, /Link to a notebook or tab/, "link");
  const picker = page.getByTestId("widget-settings").getByRole("combobox");
  await expect(picker).toBeFocused();
  await expect(page.getByRole("option", { name: /Money/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^Map/ })).toBeVisible();
  await picker.fill("mon");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  // The card appears in the document with the notebook's own words.
  await expect(page.getByTestId("link-card").filter({ hasText: "Money" })).toContainText("What the trip costs");

  // -- external: an address and words, checked before they are stored --
  await insertFromRail(page, /Link to a website/, "website");
  const address = page.getByTestId("widget-settings").getByRole("textbox", { name: /Web address/ });
  await expect(address).toBeFocused();
  await address.fill("javascript:alert(1)");
  await address.press("Enter");
  await expect(page.getByTestId("widget-settings").getByRole("alert")).toContainText("https://");
  await address.fill("www.jreast.co.jp/e/pass");
  await address.press("Enter");
  const words = page.getByTestId("widget-settings").getByRole("textbox", { name: /Link text/ });
  await words.fill("JR East rail pass");
  await words.press("Enter");
  await finishEditing(page);

  // -- both survive a reload, and read as what they are --
  await page.reload();
  await expect(page.getByRole("heading", { name: "Before you go", level: 1 })).toBeVisible();
  const external = page.getByRole("link", { name: "JR East rail pass" });
  await expect(external).toHaveAttribute("href", "https://www.jreast.co.jp/e/pass");
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");

  await page.getByTestId("link-card").filter({ hasText: "Money" }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
});
