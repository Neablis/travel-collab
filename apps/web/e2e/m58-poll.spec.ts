import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { newPageDoc, type PageNode } from "@tc/contracts";
import { expect, test } from "./fixtures/test";
import { E2E_SUPER_CODE, fillInviteCode } from "./admission";
import { grantCollaborators } from "./adminBootstrap";
import { stranger } from "./helpers";
import { e2eTripName } from "./tripNames";

// M58 part 5: the poll widget, the gate's *Poll* box.
//
// Two members vote and one changes their vote, an editor closes the poll, and
// a member can't vote after it closes. On the same notebook's public page a
// stranger sees the question and the counts, with no names and no control. As in
// `m58-public-notebook.spec.ts`, the stranger's claim is about what the server
// SENDS, so it is read from the HTML, the RSC payload and the hydrated DOM.

const paragraph = (text: string): PageNode =>
  ({ type: "paragraph", content: [{ type: "text", text }] }) as unknown as PageNode;
const widget = (name: string, params: Record<string, unknown>): PageNode =>
  ({ type: "macro", attrs: { name, params } }) as unknown as PageNode;

const QUESTION = "Where should we eat on night one?";
// The comma text a first build stored (each label is its own id); the insert test below types the rows the editor now has.
const OPTIONS = "Ramen, Sushi, Tempura";

async function createPage(page: Page, tripId: string, title: string, content: PageNode[]): Promise<string> {
  const created = await page.request.post(`/api/trips/${tripId}/pages`, {
    data: { title, context: { tripId }, content: newPageDoc(content) },
  });
  expect(created.ok()).toBe(true);
  return ((await created.json()) as { page: { id: string } }).page.id;
}

/** Whether anything on the page is wider than the window: the poll is drawn at 390 and 1440. */
const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test("two members vote and one changes theirs, an editor closes the poll, and a stranger reads counts and no names", async ({
  page,
  browser,
}) => {
  // Two member contexts and a stranger, as `m11-invites` budgets for.
  test.slow();
  // Inviting needs the owner's `trip.collaborators` (M20 link 6).
  await grantCollaborators(browser, "dev-alice");
  const tripName = e2eTripName("Poll");
  const created = await page.request.post("/api/trips", { data: { name: tripName } });
  expect(created.ok()).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };
  const pollId = randomUUID();
  const planId = await createPage(page, tripId, "Night one", [
    paragraph("Vote for dinner"),
    widget("poll", { pollId, question: QUESTION, options: OPTIONS }),
  ]);

  // Bob joins as an editor.
  const bobName = `m58poll${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const invite = await page.request.post(`/api/trips/${tripId}/invites`, { data: { email: null, role: "editor" } });
  expect(invite.ok()).toBe(true);
  const bobContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const bob = await bobContext.newPage();
    await bob.goto("/signup");
    await fillInviteCode(bob, E2E_SUPER_CODE);
    await bob.fill('input[name="username"]', bobName);
    await Promise.all([
      bob.waitForURL((url) => !/^\/sign(in|up)$/.test(url.pathname)),
      bob.getByRole("button", { name: /sign in with dev login/i }).click(),
    ]);
    const joined = await bob.request.post(`/api/invites/${((await invite.json()) as { invite: { token: string } }).invite.token}/accept`);
    expect(joined.ok(), await joined.text()).toBe(true);

    const poll = (who: Page) => who.getByRole("group", { name: QUESTION });
    const choose = async (who: Page, option: RegExp) => {
      await Promise.all([
        who.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes(`/polls/${pollId}`) && r.ok()),
        poll(who).getByRole("button", { name: option }).click(),
      ]);
    };

    // 1. Alice votes Ramen. The card names her, and everyone who has not voted.
    await page.goto(`/trips/${tripId}/pages/${planId}`);
    await expect(page.getByRole("heading", { name: "Night one", level: 1 })).toBeVisible();
    await expect(poll(page).getByText(/^Not voted yet: /)).toBeVisible();
    await choose(page, /^Ramen/);
    await expect(poll(page).getByRole("button", { name: /^Ramen/ })).toHaveAttribute("aria-pressed", "true");
    await expect(poll(page).getByRole("button", { name: /^Ramen/ })).toContainText("alice");

    // 2. Bob votes Sushi, then changes his mind to Ramen.
    await bob.goto(`/trips/${tripId}/pages/${planId}`);
    await expect(poll(bob).getByText("alice")).toBeVisible();
    await choose(bob, /^Sushi/);
    await expect(poll(bob).getByRole("button", { name: /^Sushi/ })).toHaveAttribute("aria-pressed", "true");
    await choose(bob, /^Ramen/);
    await expect(poll(bob).getByRole("button", { name: /^Ramen/ })).toHaveAttribute("aria-pressed", "true");
    await expect(poll(bob).getByRole("button", { name: /^Sushi/ })).toHaveAttribute("aria-pressed", "false");
    // Everyone has voted, so there is no one left to list.
    await expect(poll(bob).getByText(/Not voted yet/)).toHaveCount(0);

    // 3. An editor closes it. Alice's card says so and takes no more votes.
    await page.reload();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/polls/${pollId}/close`) && r.ok()),
      poll(page).getByRole("button", { name: "Close poll" }).click(),
    ]);
    await expect(poll(page).getByText("Poll closed")).toBeVisible();
    await expect(poll(page).getByRole("button", { name: "Close poll" })).toHaveCount(0);
    await expect(poll(page).getByRole("button", { name: /^Ramen/ })).toBeDisabled();

    // Bob, a member, cannot vote after it closes: no live control, and the server refuses.
    await bob.reload();
    await expect(poll(bob).getByText("Poll closed")).toBeVisible();
    await expect(poll(bob).getByRole("button", { name: /^Tempura/ })).toBeDisabled();
    const late = await bob.request.put(`/api/trips/${tripId}/polls/${pollId}`, { data: { optionIds: ["Tempura"] } });
    expect(late.status()).toBe(409);
    const counted = await bob.request.get(`/api/trips/${tripId}/polls/${pollId}`);
    expect(((await counted.json()) as { counts: Record<string, number> }).counts).toEqual({ Ramen: 2, Sushi: 0, Tempura: 0 });

    // 4. The public page: the question and counts, no names, no control.
    const shared = await page.request.post(`/api/trips/${tripId}/pages/${planId}/shares`);
    expect(shared.status()).toBe(201);
    const { token } = ((await shared.json()) as { share: { token: string } }).share;
    const path = `/n/${token}`;
    const reader = await stranger(browser);
    try {
      for (const width of [390, 1440]) {
        await reader.setViewportSize({ width, height: 900 });
        const response = await reader.goto(path);
        expect(response!.status()).toBe(200);
        const card = reader.getByRole("group", { name: QUESTION });
        await expect(card).toBeVisible();
        const ramen = card.getByRole("listitem").filter({ hasText: "Ramen" });
        await expect(ramen).toContainText("2");
        await expect(card.getByRole("listitem").filter({ hasText: "Sushi" })).toContainText("0");
        await expect(card.getByText("Poll closed")).toBeVisible();
        await expect(card.getByRole("button")).toHaveCount(0);
        await expect(card.getByText(/Not voted yet/)).toHaveCount(0);
        expect(await overflows(reader), `${width}px overflows`).toBe(false);
      }

      // What was sent, three ways: no one who voted, by name or by id, and no poll id.
      const forbidden = ["dev-alice", "alice", "Alice", bobName, bobName.toLowerCase(), `dev-${bobName}`, pollId, tripId, planId, tripName];
      const wire = {
        html: await (await reader.request.get(path)).text(),
        rsc: await (await reader.request.get(path, { headers: { rsc: "1" } })).text(),
        dom: await reader.content(),
      };
      // The checks below are empty unless the poll really is on the wire.
      expect(wire.html).toContain(QUESTION);
      expect(wire.rsc).toContain(QUESTION);
      for (const [kind, body] of Object.entries(wire)) {
        for (const secret of forbidden) expect(body.includes(secret), `${kind} carries ${secret}`).toBe(false);
      }
    } finally {
      await reader.context().close();
    }

    // A member sees the same public page too: the stranger's, with no vote control.
    await page.goto(path);
    await expect(page.getByRole("group", { name: QUESTION }).getByRole("button")).toHaveCount(0);
  } finally {
    await bobContext.close();
  }
});

test("a poll is inserted from the editor, with its question and options typed in its settings", async ({ page }) => {
  const created = await page.request.post("/api/trips", { data: { name: e2eTripName("Poll insert") } });
  expect(created.ok()).toBe(true);
  const { tripId } = (await created.json()) as { tripId: string };
  const planId = await createPage(page, tripId, "Dinner plans", [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Dinner" }] } as unknown as PageNode,
  ]);

  await page.goto(`/trips/${tripId}/pages/${planId}`);
  await page.getByRole("button", { name: "Edit page" }).click();
  await page.locator(".tc-page-editor h2").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("searchbox", { name: "Search widgets" }).fill("poll");
  await page.getByRole("complementary").getByRole("list").getByRole("button", { name: /^Poll/ }).click();

  const settings = page.getByTestId("widget-settings");
  await expect(settings).toBeVisible();
  const question = settings.getByRole("textbox", { name: /Question/ });
  await question.fill(QUESTION);
  await question.press("Enter");
  // Two blank rows come with the widget; a third is added, then removed with a question.
  for (const [index, label] of ["Ramen", "Sushi"].entries()) {
    const row = settings.getByRole("textbox", { name: `Option ${index + 1}` });
    await row.fill(label);
    await row.press("Enter");
  }
  await settings.getByRole("button", { name: "Add option" }).click();
  const third = settings.getByRole("textbox", { name: "Option 3" });
  await third.fill("Pizza");
  await third.press("Enter");
  await settings.getByRole("button", { name: "Remove option 3" }).click();
  await page.getByRole("dialog", { name: "Remove this option?" }).getByRole("button", { name: "Remove option" }).click();
  await expect(settings.getByRole("textbox", { name: "Option 3" })).toHaveCount(0);
  await settings.getByRole("button", { name: "Add option" }).click();
  const last = settings.getByRole("textbox", { name: "Option 3" });
  await last.fill("Tempura");
  await last.press("Enter");
  await expect(page.getByRole("group", { name: QUESTION })).toBeVisible();

  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/pages/${planId}`) && r.ok()),
    page.getByRole("button", { name: "Done editing" }).click(),
  ]);
  // Saved with its own id, so the votes have something to be about.
  const saved = await page.request.get(`/api/trips/${tripId}/pages/${planId}`);
  expect(JSON.stringify(await saved.json())).toMatch(/"pollId":"[0-9a-f-]{36}"/);
  const card = page.getByRole("group", { name: QUESTION });
  await expect(card.getByRole("button", { name: /^Tempura/ })).toBeVisible();
});
