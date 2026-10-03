import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures/test";
import { forget, publishedDay, stranger } from "./helpers";

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
  // `/` is two pages by session: never stored by a CDN or the browser. (A
  // `Vary: Cookie` set beside this is not asserted because it does not arrive:
  // Next replaces `Vary` on the rewritten response with its own RSC list.)
  expect(response.headers()["cache-control"]).toBe("private, no-store");
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
  // As whole lines, so `Disallow: /api/` cannot pass for a site-wide one.
  expect(body).toMatch(/^Allow: \/$/m);
  expect(body).toMatch(/^Allow: \/api\/og\/playbooks$/m);
  expect(body).not.toMatch(/^Disallow: \/$/m);
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
  // /playbooks passes the Playbooks card as its `image`; twitter states no
  // images of its own, so it must inherit that card. The site card is also
  // a twitter:image, so the match is on the card's path, not mere presence.
  expect(playbooks).toMatch(/<meta name="twitter:image" content="[^"]*\/api\/og\/playbooks/);

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

test("sitemap.xml lists the static routes and published days, never a private one", async ({ page, browser }) => {
  test.slow();
  const city = `Sitemape2e${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const publishedId = await publishedDay(page, city, `Listed ${city}`);
  const privateId = await publishedDay(page, city, `Withdrawn ${city}`);
  const visitor = await stranger(browser);
  try {
    // Unpublished again: private, and so absent, like a deleted or moderated day.
    await page.request.delete(`/api/saved-days/${privateId}/publish`);
    const response = await visitor.request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const xml = await response.text();
    for (const path of ["/playbooks", "/demo", "/developers", "/developers/reference"]) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]*${path}</loc>`));
    }
    expect(xml).toMatch(new RegExp(`<loc>[^<]*/playbooks/day/${publishedId}</loc>`));
    expect(xml).not.toContain(privateId);
    expect(xml).not.toContain("/playbooks/board");
    expect(xml).not.toContain("/playbooks/profile/");
  } finally {
    // A failed assertion still closes the stranger and removes both days,
    // and the private one goes even if `forget` throws (CodeRabbit, PR #296).
    await visitor.context().close();
    await forget(page, publishedId).finally(() => page.request.delete(`/api/saved-days/${privateId}`));
  }
});
