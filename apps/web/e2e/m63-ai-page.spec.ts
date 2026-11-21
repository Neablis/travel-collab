import { expect, test } from "./fixtures/test";

// `/ai` is read by a crawler and by an agent that never runs the page's
// JavaScript. No JS at all is the honest stand-in: the server HTML is
// everything the page can say.
test.use({ javaScriptEnabled: false });
test.use({ storageState: { cookies: [], origins: [] } });

const PROMPTS = [
  "Turn my Lisbon trip into a three-day playbook and publish it.",
  "Which of my trips has a day with nothing planned yet?",
  "Draft a playbook day in Kyoto around three restaurants I name, and put each on the map.",
  "Look through the library and pick the days that suit a rainy weekend in Porto.",
  "List the cities that have published days in Caesura's library.",
  "List the names of all my trips and save them to a file.",
];

test("/ai answers HTML with one h1 and every prompt visible", async ({ page }) => {
  const response = await page.goto("/ai");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  for (const prompt of PROMPTS) {
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  }
});

test("/ai says what Caesura is, in the words people search, in the server HTML", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI trip planner");
  await expect(page.getByText("trip planner MCP server")).toBeVisible();
  await expect(page.getByRole("link", { name: /playbook/i })).toHaveAttribute("href", "/playbooks");
});
