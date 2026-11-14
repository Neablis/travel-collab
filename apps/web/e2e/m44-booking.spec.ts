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

  const chip = page.getByRole("button", { name: /^Booked · Hotel Okura/ });
  await expect(chip).toBeVisible();

  // The notice must take a real pointer: jsdom loads no CSS, so only a browser
  // sees a block's `pointer-events-none` swallow a click on "Open link".
  await chip.click();
  const toast = page.getByTestId("toast");
  await expect(toast).toBeVisible();
  // The link is not a real host; answer it so the popup lands on its URL.
  await page.context().route("https://okura.example/**", (route) => route.fulfill({ body: "ok", contentType: "text/html" }));
  const popup = page.waitForEvent("popup");
  await toast.getByRole("button", { name: "Open link" }).click();
  const opened = await popup;
  await opened.waitForLoadState();
  expect(opened.url()).toContain("okura.example/manage");
  await opened.close();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();

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

// A short card at phone width (KI-2026-11-03-a). A 44px chip would reach over
// a short card's edit target, and a smaller button is below SPEC §13.1's floor,
// so on a phone the chip is a label and the code is copied from the editor.
// The tap lands ON the chip: a click beside it could not tell a chip that still
// takes the tap from one that lets it through to the card.
test("on a short phone card the Booked chip is a label, a tap on it opens the editor, and the editor copies the code", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await page.request.post("/api/trips", { data: { name: e2eTripName("Booking phone") } });
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
    title: "Quick check-in",
    timeWindow: { start: "14:00", end: "14:30" },
    booking: { confirmation: "ZX9QK7", provider: "Hotel Okura" },
  });

  await page.goto(`/trips/${tripId}?view=Plan`);
  const card = page.getByTestId(/^activity-card-/);
  const chip = card.getByTestId("booking-chip-label");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText("Booked · Hotel Okura");
  await expect(card.getByRole("button", { name: /^Booked · Hotel Okura/ })).toHaveCount(0);
  const cardBox = (await card.boundingBox())!;
  const chipBox = (await chip.boundingBox())!;
  expect(chipBox.y).toBeGreaterThanOrEqual(cardBox.y - 0.5);
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);

  await page.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await expect(page.getByRole("heading", { name: "Edit activity" })).toBeVisible();
  await expect(page.getByTestId("toast")).toHaveCount(0);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = page.getByRole("button", { name: "Copy code" });
  await expect(copy).toBeVisible();
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(page.getByText("Code copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ZX9QK7");
});
