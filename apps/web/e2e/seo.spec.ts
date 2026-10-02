import { expect, test } from "./fixtures/test";
import { stranger } from "./helpers";

// The SEO pass's one script (spec 2026-10-02-seo-pass §6). What a crawler
// receives is the server's HTML, so most of this reads responses rather than
// driving a page.

// The headline as an element, not as text: the site description in every
// page's <head> opens with the same words.
const HEADLINE = /Put the best day on repeat\.<\/h[12]>/;

test("a signed-out / serves the landing in place, uncached, with one h1", async ({ browser }) => {
  const visitor = await stranger(browser);
  const response = await visitor.request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const html = await response.text();
  expect(html).toMatch(HEADLINE);
  // The phone and desktop trees are both in the document; only one may be an h1.
  expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  // The root's canonical is the bare origin: Next drops the trailing slash.
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
  expect(new URL(canonical).pathname).toBe("/");
  await visitor.context().close();
});

test("a signed-in / is the app home, never the landing", async ({ page }) => {
  const html = await (await page.request.get("/", { maxRedirects: 0 })).text();
  expect(html).not.toMatch(HEADLINE);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
});

test("robots.txt allows the site, keeps /api out, and names the sitemap", async ({ browser }) => {
  const visitor = await stranger(browser);
  const body = await (await visitor.request.get("/robots.txt")).text();
  expect(body).toContain("Disallow: /api/");
  expect(body).toMatch(/Sitemap: \S+\/sitemap\.xml/);
  expect(body).not.toContain("/invite");
  expect(body).not.toContain("/s/");
  await visitor.context().close();
});

test("page metadata: canonical, description, title and twitter image", async ({ browser }) => {
  const visitor = await stranger(browser);
  const head = async (path: string) => (await visitor.request.get(path)).text();

  // One page whatever its filters: the canonical drops the query string.
  const playbooks = await head("/playbooks?city=Kyoto");
  expect(playbooks).toMatch(/<link rel="canonical" href="[^"]*\/playbooks"/);
  // A page that passes a preview image resolves a twitter:image from it.
  expect(playbooks).toMatch(/<meta name="twitter:image" content="[^"]+"/);

  const demo = await head("/demo");
  expect(demo).toMatch(/<meta name="description" content="[^"]{10,}"/);
  const title = /<title>([^<]*)<\/title>/.exec(demo)?.[1] ?? "";
  expect(title).toContain("An example trip");
  expect(title).not.toContain("— Caesura — Caesura");

  // `noindex` on /signin cannot be told apart here: every non-production
  // build is `noindex, nofollow` site-wide (`siteRobots`), the same value
  // /signin sets for itself, so an assertion on the tag could not fail in
  // this lane, and none is written.
  await visitor.context().close();
});
