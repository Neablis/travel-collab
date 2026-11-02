import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures/test";
import { e2eTripName } from "./tripNames";

// M44 part 4 (ADR-086): an owner records what was booked on a stop, the card
// says so, and the trip's share link shows the stop without the code. The
// redaction itself is part 3's integration tests; what only a browser proves
// is that the section, the autosave and the chip reach each other, and that
// the page a stranger is sent really carries no confirmation number.

test("an owner books a stop, sees the chip on its card, and a share link shows no code", async ({ page, browser }) => {
  test.slow();
  const tripName = e2eTripName("Booking");
  const created = await page.request.post("/api/trips", { data: { name: tripName } });
  expect(created.ok()).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };
  const command = async (body: object) => {
    const response = await page.request.post(`/api/trips/${tripId}/commands`, { data: body });
    expect(response.ok(), JSON.stringify(body)).toBe(true);
  };
  const dayId = randomUUID();
  await command({ type: "AddDay", tripId, dayId });
  await command({
    type: "AddActivity",
    tripId,
    activityId: randomUUID(),
    dayId,
    title: "Hotel check-in",
    timeWindow: { start: "14:00", end: "16:00" },
  });

  await page.goto(`/trips/${tripId}?view=Plan`);
  await page.getByRole("button", { name: /^Edit Hotel check-in/ }).click();
  await expect(page.getByRole("heading", { name: "Edit activity" })).toBeVisible();

  // Collapsed until asked for.
  await expect(page.getByLabel("Confirmation")).toBeHidden();
  await page.getByText("Booking", { exact: true }).click();
  await page.getByLabel("Confirmation").fill("ZX9QK7");
  await page.getByLabel("Provider").fill("Hotel Okura");
  await page.getByLabel("Link").fill("https://okura.example/manage");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Edit activity" })).toBeHidden();

  await expect(page.getByRole("button", { name: "Booked · Hotel Okura" })).toBeVisible();

  const shared = await page.request.post(`/api/trips/${tripId}/shares`);
  expect(shared.ok()).toBe(true);
  const { share } = (await shared.json()) as { share: { token: string } };

  const readerContext = await browser.newContext({ storageState: undefined });
  const reader = await readerContext.newPage();
  try {
    await reader.goto(`/s/${share.token}`);
    await expect(reader.getByRole("heading", { name: tripName, level: 1 })).toBeVisible();
    await expect(reader.getByText("Hotel check-in").first()).toBeVisible();
    await expect(reader.getByText("ZX9QK7")).toHaveCount(0);
    // Not in the document at all, which is what a screen reader or a view-source reads.
    expect(await reader.content()).not.toContain("ZX9QK7");
    expect(await reader.content()).not.toContain("okura.example");
  } finally {
    await readerContext.close();
  }
});
