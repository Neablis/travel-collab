import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { openAccountPage, signInAsDevUser } from "./helpers";
import { e2eTripName } from "./tripNames";

// M17's exit gate, walked as one flow: a signed-in person sets their name and
// home airport, switches to Miles, watches a distance in the app change — and
// finds all three still there after a reload.
//
// **A fresh dev user, not the shared alice session**, and `storageState:
// undefined` is what makes that true (the "desktop" project pins alice's saved
// state; inheriting it here would leave a display name on the account every
// other spec signs in as, which several of them render). Same reasoning
// m11-clone.spec.ts records for its own second actor.
test.use({ storageState: undefined });

const HOME_AIRPORT = "SFO";
const DISPLAY_NAME = "Mitchell M17";

// Two real coordinates about 5 km apart, so the day has a total the rail can
// render and the number is comfortably above `kmLabel`'s feet threshold
// (0.19 mi) in either system — the assertion is "the units changed", and a
// distance that crossed into feet would change the shape of the label too.
const STOPS = [
  { name: "Tokyo Station", city: "Tokyo", lat: 35.6812, lng: 139.7671, countryCode: "JP" },
  { name: "Nezu Museum", city: "Tokyo", lat: 35.6626, lng: 139.7166, countryCode: "JP" },
];

/** A one-day trip whose two located stops give the map rail a distance to show. */
async function createTripWithADistance(page: Page, name: string): Promise<string> {
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data });
    expect(response.ok(), `POST ${path} -> ${response.status()}`).toBe(true);
    return response.json();
  };

  const { tripId } = (await post("/api/trips", { name })) as { tripId: string };
  const dayId = crypto.randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  for (const location of STOPS) {
    await post(`/api/trips/${tripId}/commands`, {
      type: "AddActivity",
      tripId,
      activityId: crypto.randomUUID(),
      dayId,
      title: location.name,
      location,
    });
  }
  return tripId;
}

test("account preferences: a name, a home airport, and miles that stick", async ({ page }) => {
  // A fresh account each run, so the preferences this spec writes belong to
  // nobody else and the "unset at first" assertions below mean something.
  // Timestamp for readable debris, random suffix for actual uniqueness — the
  // same shape and the same reason as `e2eTripName`, whose comment records the
  // lesson: Playwright runs workers in parallel against ONE database, so
  // `Date.now()` alone collides within a millisecond and the second worker
  // reuses the first's account, failing this spec's initial-empty assertions.
  // Flagged in review on pull request 112.
  const username = `m17${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);

  const tripId = await createTripWithADistance(page, e2eTripName("M17Prefs"));
  await page.goto(`/trips/${tripId}?view=Map`);

  const dayTile = page.locator('[aria-label="Days"] button[data-day-index="0"]');
  // Kilometres is the storage default, so this is what a brand-new account
  // sees before it has expressed any preference at all.
  await expect(dayTile).toContainText(/· \d+(\.\d)? km/);

  await openAccountPage(page);

  const nameField = page.getByLabel("Your name");
  const airportField = page.getByLabel("Home airport");
  await expect(nameField).toHaveValue("");
  await expect(airportField).toHaveValue("");

  await nameField.fill(DISPLAY_NAME);
  await airportField.click(); // blur commits the name

  // Typed in lower case on purpose. `UserPreferences` validates `^[A-Z]{3}$`
  // and carries no transform — the ROUTE normalizes, before the parse — so
  // this is the assertion that the server did it and the client is showing
  // back what was actually stored.
  await airportField.fill(HOME_AIRPORT.toLowerCase());
  await nameField.click();
  await expect(airportField).toHaveValue(HOME_AIRPORT);

  await page.getByRole("radio", { name: "Miles" }).click();
  await expect(page.getByRole("radio", { name: "Miles" })).toHaveAttribute("aria-checked", "true");

  // Leave the account page so the assertion below is about what the TRIP
  // shows. This was `Escape` while account settings were a modal Sheet; since
  // M26 link 1 they are a route, so leaving is a navigation — and going back is
  // the honest way a person gets there, rather than a second `goto`.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeHidden();

  // The gate's second box: switching the unit changes a distance in the app,
  // through `kmLabel`, with no per-trip unit field anywhere.
  await expect(dayTile).toContainText(/· \d+(\.\d)? mi/);
  await expect(dayTile).not.toContainText(/· \d+(\.\d)? km/);

  // The gate's first box: both survive a reload, which is the cheap half of
  // "a server restart" — the values are columns on `users`, not client state.
  await page.reload();
  await expect(dayTile).toContainText(/· \d+(\.\d)? mi/);

  await openAccountPage(page);
  await expect(page.getByLabel("Your name")).toHaveValue(DISPLAY_NAME);
  await expect(page.getByLabel("Home airport")).toHaveValue(HOME_AIRPORT);
  await expect(page.getByRole("radio", { name: "Miles" })).toHaveAttribute("aria-checked", "true");

  // And the chosen name is what the account menu calls this person — the
  // display-name seam (`displayNameFor`), with `displayName` at the front of
  // its chain. Without it the menu would still be showing the dev-login
  // handle derived from the id.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText(DISPLAY_NAME)).toBeVisible();
});

// The Time setting beside Distance (Mitchell, PR #221: *"All times should be
// in AM/PM not military time (though maybe a good idea to have that as a
// setting to toggle on)"*): 12-hour by default, and a board card's window
// follows the switch to 24-hour without a reload — then keeps it across one.
// Its own fresh account and trip, for the reason the test above gives: the
// shared alice session is read by every other spec, and a 24-hour clock left
// on it would move their 12-hour assertions.
test("account preferences: the board's clock follows the Time setting", async ({ page }) => {
  const username = `m17t${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await signInAsDevUser(page, username);

  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { data });
    expect(response.ok(), `POST ${path} -> ${response.status()}`).toBe(true);
    return response.json();
  };
  const { tripId } = (await post("/api/trips", { name: e2eTripName("M17Clock") })) as { tripId: string };
  const dayId = crypto.randomUUID();
  const activityId = crypto.randomUUID();
  await post(`/api/trips/${tripId}/commands`, { type: "AddDay", tripId, dayId });
  await post(`/api/trips/${tripId}/commands`, {
    type: "AddActivity",
    tripId,
    activityId,
    dayId,
    title: "Tsukiji breakfast",
    timeWindow: { start: "09:00", end: "14:30" },
  });

  await page.goto(`/trips/${tripId}?view=Plan`);
  const card = page.getByTestId(`activity-card-${activityId}`);
  await expect(card).toContainText("9 am – 2:30 pm");

  await openAccountPage(page);
  await expect(page.getByRole("radio", { name: "12-hour (2:30 pm)" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "24-hour (14:30)" }).click();
  await expect(page.getByRole("radio", { name: "24-hour (14:30)" })).toHaveAttribute("aria-checked", "true");

  await page.goBack();
  await expect(card).toContainText("09:00 – 14:30");
  await expect(card).not.toContainText("pm");

  await page.reload();
  await expect(card).toContainText("09:00 – 14:30");
});
