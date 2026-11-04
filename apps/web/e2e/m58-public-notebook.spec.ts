import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { newPageDoc, type PageNode } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { stranger } from "./helpers";
import { e2eTripName } from "./tripNames";

// M58 part 3: `/n/<token>`, a notebook read by someone with no account.
//
// The claims are about what the server SENDS, so they are read from the wire
// three ways with JavaScript on: the HTML the server rendered, the RSC payload
// the client is handed (`rsc: 1`), and the DOM after hydration. A hidden
// widget's params, a member's id, a booking's code and the trip's name must be
// in none of them.

const BOOKING_CODE = "ZQ9XK2";
const BOOKING_URL = "https://sushi.example/manage/ZQ9XK2";
const HIDDEN_PARAM = "zz-hidden-param";

const paragraph = (...content: PageNode[]): PageNode => ({ type: "paragraph", content }) as unknown as PageNode;
const text = (value: string): PageNode => ({ type: "text", text: value }) as unknown as PageNode;
const widget = (name: string, params: Record<string, unknown>, hideWhenPublic?: true): PageNode =>
  ({ type: "macro", attrs: hideWhenPublic ? { name, params, hideWhenPublic } : { name, params } }) as unknown as PageNode;

async function createPage(page: Page, tripId: string, title: string, content: PageNode[]): Promise<string> {
  const created = await page.request.post(`/api/trips/${tripId}/pages`, {
    data: { title, context: { tripId }, content: newPageDoc(content) },
  });
  expect(created.ok()).toBe(true);
  return ((await created.json()) as { page: { id: string } }).page.id;
}

async function publish(page: Page, tripId: string, pageId: string): Promise<{ shareId: string; token: string }> {
  const response = await page.request.post(`/api/trips/${tripId}/pages/${pageId}/shares`);
  expect(response.status()).toBe(201);
  return ((await response.json()) as { share: { shareId: string; token: string } }).share;
}

test("a public notebook shows a stranger the plan, keeps the rest on the server, and goes dead when made private", async ({
  page,
  browser,
}) => {
  test.slow();
  const tripName = e2eTripName("Public");
  const created = await page.request.post("/api/trips", { data: { name: tripName } });
  expect(created.ok()).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };

  // A day with a booked stop: the code and its manage link are the floor.
  const dayId = randomUUID();
  for (const command of [
    { type: "AddDay", tripId, dayId },
    {
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      dayId,
      title: "Dinner at Sushi Dai",
      timeWindow: { start: "19:00", end: "20:00" },
      booking: { confirmation: BOOKING_CODE, provider: "Sushi Dai", url: BOOKING_URL },
    },
  ]) {
    const response = await page.request.post(`/api/trips/${tripId}/commands`, { data: command });
    expect(response.ok(), JSON.stringify(command)).toBe(true);
  }
  // The dev user the "desktop" project signs in as; a member id is what an `addedBy` would print.
  const memberId = "dev-alice";

  const packingId = await createPage(page, tripId, "Packing list", [paragraph(text("Socks and a charger"))]);
  const surpriseId = await createPage(page, tripId, "Surprise for Sam", [paragraph(text("Do not tell"))]);
  const packing = await publish(page, tripId, packingId);

  const planId = await createPage(page, tripId, "Our Japan plan", [
    paragraph(text("Welcome to the plan")),
    // Hidden by the publisher: its params must not leave the server.
    paragraph(widget("link.external", { href: `https://${HIDDEN_PARAM}.example/`, label: "Secret" }, true)),
    paragraph(widget("attribute", { field: "trip.name" }, true)),
    widget("day.detail", {}),
    widget("link.internal", { to: { kind: "notebook", pageId: packingId } }),
    widget("link.internal", { to: { kind: "notebook", pageId: surpriseId } }),
    widget("link.internal", { to: { kind: "view", view: "Plan" } }),
  ]);
  const plan = await publish(page, tripId, planId);

  // The token is the whole address: 43 base64url characters, no id, no title.
  expect(plan.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const path = `/n/${plan.token}`;
  for (const id of [tripId, planId, "Our Japan plan", "Japan"]) expect(path).not.toContain(id);

  const reader = await stranger(browser);
  try {
    const response = await reader.goto(path);
    expect(response!.status()).toBe(200);
    expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response!.headers()["cache-control"]).toContain("no-store");

    await expect(reader.getByRole("heading", { name: "Our Japan plan", level: 1 })).toBeVisible();
    await expect(reader.getByText("Welcome to the plan")).toBeVisible();
    await expect(reader.getByText("Dinner at Sushi Dai").first()).toBeVisible();
    // The two hidden widgets: told something is here, and nothing about it.
    await expect(reader.getByText("Not shared")).toHaveCount(2);

    // Links: a public notebook opens its /n/ address; a private one, and a tab, are text.
    const cards = reader.getByTestId("link-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute("href", `/n/${packing.token}`);
    await expect(cards.nth(1)).toContainText("Surprise for Sam");
    await expect(cards.nth(1)).not.toHaveAttribute("href", /.*/);
    await expect(cards.nth(2)).not.toHaveAttribute("href", /.*/);

    // No way in, and the band is the page's last word.
    await expect(reader.getByRole("link", { name: /open in the trip/i })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: /join|request access|invite/i })).toHaveCount(0);
    await expect(reader.getByRole("main").getByRole("link", { name: "Start planning — free" })).toHaveAttribute(
      "href",
      /^\/signup\?ref=public-notebook&callbackUrl=%2Fhome%3Fnew%3Dtrip$/,
    );

    // What was sent, three ways. Every string here is one the page must not carry.
    const forbidden = [BOOKING_CODE, BOOKING_URL, HIDDEN_PARAM, tripName, memberId, tripId, planId, packingId, surpriseId];
    const wire = {
      html: await (await reader.request.get(path)).text(),
      rsc: await (await reader.request.get(path, { headers: { rsc: "1" } })).text(),
      dom: await reader.content(),
    };
    expect(wire.html).toContain("Welcome to the plan");
    expect(wire.rsc).toContain("Welcome to the plan");
    for (const [kind, body] of Object.entries(wire)) {
      for (const secret of forbidden) expect(body.includes(secret), `${kind} carries ${secret}`).toBe(false);
    }
    expect(wire.html).toMatch(/<meta name="robots" content="noindex/);

    // Following the link to the second public notebook needs no account.
    await cards.nth(0).click();
    await expect(reader.getByRole("heading", { name: "Packing list", level: 1 })).toBeVisible();
    await expect(reader.getByText("Socks and a charger")).toBeVisible();
  } finally {
    await reader.context().close();
  }

  // A member sees the stranger's page, not their own notebook.
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Our Japan plan", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /open in the trip/i })).toHaveCount(0);

  // Not in the sitemap.
  expect(await (await page.request.get("/sitemap.xml")).text()).not.toContain(plan.token);

  // Private again: the next request is a 404 that names nothing, with the way in kept.
  const revoked = await page.request.delete(`/api/trips/${tripId}/pages/${planId}/shares/${plan.shareId}`);
  expect(revoked.ok()).toBe(true);
  const after = await stranger(browser);
  try {
    const gone = await after.goto(path);
    expect(gone!.status()).toBe(404);
    const body = await after.content();
    for (const named of ["Our Japan plan", tripName, "Welcome to the plan"]) expect(body.includes(named), named).toBe(false);
    await expect(after.getByRole("link", { name: "Start planning — free" })).toBeVisible();

    // And a second publish is a new address; the old one stays dead.
    const again = await publish(page, tripId, planId);
    expect(again.token).not.toBe(plan.token);
    expect((await after.goto(path))!.status()).toBe(404);
    expect((await after.goto(`/n/${again.token}`))!.status()).toBe(200);
  } finally {
    await after.context().close();
  }
});
