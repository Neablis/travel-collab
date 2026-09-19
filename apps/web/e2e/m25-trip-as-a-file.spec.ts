import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_SUPER_CODE } from "./admission";
import { e2eTripName } from "./tripNames";

// **M25's exit gate, walked** — *"A trip is a file you can take with you."*
//
// Three of its boxes are only true end to end, and each is something a person
// does rather than a function that returns:
//
//   1. **A `free`-plan account exports a trip and re-imports it**, with no
//      entitlement anywhere on that path and no upgrade prompt on any screen it
//      touches. The milestone's most important NEGATIVE, and the reason this
//      file exists most: export is free by Mitchell's decision, and the way
//      that breaks is a gate arriving on the path rather than an error.
//   2. **The downloaded bytes are the file.** `export.free.test.ts` and the
//      `int` suite can both prove the route ANSWERS a bundle; only a browser
//      can prove that the thing landing on a person's disk is that answer.
//      A `Content-Disposition` mistake, a client-side re-wrap, a JSON envelope
//      — each would pass every other layer and hand somebody a file the
//      importer refuses.
//   3. **Reachability**: this is done by clicking, which is the Definition of
//      Done's rule for every milestone.
//
// **A fresh account per test.** M25 turns on what an account holds, and
// `auth.setup.ts`'s shared alice has existed for many runs — mirroring
// `m20-entitlements.spec.ts`, which mints newcomers for the same reason. A
// newcomer here is on `free`, which is exactly the account the gate asks about.
//
// Each test drives a full sign-in, so `test.slow()` — a budget failure is fixed
// with the budget, not with a retry.

function newcomer(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function signInAs(page: Page, username: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Invite code").fill(E2E_SUPER_CODE);
  // eslint-disable-next-line playwright/prefer-locator -- matches signInAsDevUser's grandfathered selector
  await page.fill('input[name="username"]', username);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/trips") && r.request().method() === "GET" && r.ok(),
    ),
    page.getByRole("button", { name: /sign in with dev login/i }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
}

async function createTrip(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/trips", { data: { name } });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { tripId: string }).tripId;
}

/** A day and a stop, through the app's own command API as the signed-in user. */
async function planADay(page: Page, tripId: string, title: string): Promise<void> {
  const dayId = randomUUID();
  for (const command of [
    { type: "AddDay", tripId, dayId },
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title,
      timeWindow: { start: "09:00", end: "11:30" },
    },
  ]) {
    const response = await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("M25 — a trip is a file you can take with you", () => {
  test.slow();

  test("a free account downloads a trip and imports it back, by clicking", async ({ page }) => {
    await signInAs(page, newcomer("m25free"));
    const name = e2eTripName("M25 round trip");
    const tripId = await createTrip(page, name);
    await planADay(page, tripId, "Fushimi Inari");

    await page.goto(`/trips/${tripId}?view=Plan`);
    await page.getByRole("button", { name: "Trip settings" }).click();

    // **The bytes that land on disk**, which is the thing no other layer can
    // see. Everything below reads the downloaded file rather than the
    // response body.
    const download = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download as a file" }).click(),
    ]).then(([event]) => event);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");

    const bundle = JSON.parse(text) as {
      $schema: string;
      trips: { name: string; days: { stops: { title: string }[] }[] }[];
    };
    expect(bundle.$schema).toBe("travel-collab/content-bundle/v1");
    expect(bundle.trips[0]!.name).toBe(name);
    expect(bundle.trips[0]!.days[0]!.stops.map((s) => s.title)).toEqual(["Fushimi Inari"]);

    // **No upgrade prompt belonging to the download** — and the gate box's
    // literal wording ("no upgrade prompt on any screen it touches") cannot be
    // asserted as written, which is worth stating rather than quietly
    // weakening.
    //
    // This sheet also hosts *Invite someone*, which M20 gates on
    // `trip.collaborators` and M21 renders as a disabled form under a CTA to
    // `plans` (SPEC §17.3, as M21 reversed it). That prompt predates M25, is
    // about a different feature, and is correct. A blanket `toHaveCount(0)`
    // here would therefore have failed — it did, on the first run — and
    // "passing" it would have meant moving the download to a different screen
    // to satisfy a test, which is a test dictating product placement.
    //
    // So the assertion is the specific one, which is also the stronger one:
    // the only upgrade prompt on this screen is the collaborators gate, it
    // names inviting rather than exporting, and the download beside it is
    // live.
    const upgrades = page.getByRole("link", { name: /upgrade|see plans/i });
    await expect(upgrades).toHaveCount(1);
    await expect(upgrades).toHaveAttribute("data-testid", "collaborators-gate-cta");
    await expect(page.getByTestId("collaborators-gate")).toContainText("Inviting people");
    // The download itself carries no gate: it is a link, enabled, and it just
    // produced the file asserted above.
    await expect(page.getByRole("link", { name: "Download as a file" })).toBeEnabled();

    // **Now import it back, by clicking.** Home, beside "New trip".
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();

    const chooser = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Import a file" }).click(),
    ]).then(([event]) => event);
    await chooser.setFiles({
      name: "trip.json",
      mimeType: "application/json",
      buffer: Buffer.from(text, "utf8"),
    });

    // It lands on the NEW trip, which is a different trip from the one it came
    // from — the milestone's "an upload can never overwrite a trip", seen.
    await page.waitForURL(/\/trips\/[0-9a-f-]{36}/);
    const landedOn = new URL(page.url()).pathname.split("/")[2]!;
    expect(landedOn).not.toBe(tripId);

    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    await expect(page.getByText("Fushimi Inari").first()).toBeVisible();
  });

  test("a file that is not a bundle is refused on the page, and nothing is created", async ({
    page,
  }) => {
    await signInAs(page, newcomer("m25refuse"));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();

    const chooser = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Import a file" }).click(),
    ]).then(([event]) => event);
    await chooser.setFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" }), "utf8"),
    });

    // The server's own refusal, rendered where the person is.
    await expect(page.getByRole("alert")).toBeVisible();
    // Still on Home — no trip was created and nothing navigated.
    await expect(page).toHaveURL(/\/$/);
    const trips = await page.request.get("/api/trips");
    expect(((await trips.json()) as { trips: unknown[] }).trips).toHaveLength(0);
  });
});
