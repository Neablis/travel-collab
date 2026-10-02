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
  // Unpublished again: private, and so absent, like a deleted or moderated day.
  await page.request.delete(`/api/saved-days/${privateId}/publish`);

  try {
    const visitor = await stranger(browser);
    const response = await visitor.request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const xml = await response.text();
    for (const path of ["/playbooks", "/demo", "/developers", "/developers/reference"]) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]*${path}</loc>`));
    }
    // By its slugged URL, the one the day page answers 200 on: a bare id
    // here would hand a crawler a redirect for every day.
    expect(xml).toMatch(new RegExp(`<loc>[^<]*/playbooks/day/listed-${city.toLowerCase()}-${publishedId}</loc>`));
    expect(xml).not.toContain(privateId);
    expect(xml).not.toContain("/playbooks/board");
    expect(xml).not.toContain("/playbooks/profile/");
    await visitor.context().close();
  } finally {
    await forget(page, publishedId);
    await page.request.delete(`/api/saved-days/${privateId}`);
  }
});

// A day's canonical path as the page builds it (`lib/playbookUrls.ts`), spelled
// again here so a change to the slug rule fails a test rather than moving it.
const sluggedPath = (name: string, savedDayId: string) =>
  `/playbooks/day/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${savedDayId}`;

test("a day link with no slug, a stale one or a mangled one is a 308 to its current URL", async ({ page, browser }) => {
  test.slow();
  const name = `Crawlable day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, `Seoe2e${randomUUID().slice(0, 6)}`, name);
  try {
    const visitor = await stranger(browser);
    const slugged = sluggedPath(name, savedDayId);

    // The bare id is a link somebody already shared: it redirects, permanently.
    const bare = await visitor.request.get(`/playbooks/day/${savedDayId}`, { maxRedirects: 0 });
    expect(bare.status()).toBe(308);
    expect(bare.headers().location).toBe(slugged);

    // So does a stale slug, and it keeps the query string.
    const stale = await visitor.request.get(`/playbooks/day/an-old-name-${savedDayId}?from=board`, { maxRedirects: 0 });
    expect(stale.status()).toBe(308);
    expect(stale.headers().location).toBe(`${slugged}?from=board`);

    // The target is rebuilt from the day, never from what was asked for: a
    // doubled hyphen and an upper-cased id land on the same one URL.
    const mangled = await visitor.request.get(`/playbooks/day/Crawlable--day-${savedDayId.toUpperCase()}`, { maxRedirects: 0 });
    expect(mangled.status()).toBe(308);
    expect(mangled.headers().location).toBe(slugged);

    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

test("a day's HTML holds its name and its stops without JavaScript", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const name = `Crawlable day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  try {
    const visitor = await stranger(browser);
    // The response body is what a crawler reads.
    const response = await visitor.request.get(sluggedPath(name, savedDayId), { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();
    // As the heading, not merely somewhere: the <title> holds the name too.
    expect(html).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
    // In an element, not only in the serialized props React hydrates from.
    expect(html).toContain(`>Stop in ${city}<`);
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

test("a day's head: name and first city in the title, the facts line, a slugged canonical", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const name = `Crawlable day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  try {
    const visitor = await stranger(browser);
    const slugged = sluggedPath(name, savedDayId);
    const html = await (await visitor.request.get(slugged)).text();
    expect(html).toContain(`<title>${name} · ${city} — Caesura</title>`);
    // No summary on this day, so the facts line; the author as the library names them.
    expect(html).toMatch(new RegExp(`<meta name="description" content="${city} · 1 stop · by [^"·]+"`));
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${slugged}"`));
    // The card's title stays the bare name: og:site_name carries the brand.
    expect(html).toContain(`<meta property="og:title" content="${name}"`);
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

// A 404 body with what belongs to the REQUEST taken out, so two of them can be
// compared for what they say about the day. Three things, each measured on a
// production build (2026-10-02) and nothing else:
//  - Sentry's `sentry-trace` and `baggage` metas: a random trace id per request.
//  - The path that was asked for, which Next echoes into its router state.
//  - The ORDER of the rows in Next's flight payload. They are written as they
//    resolve, so the order follows timing: the rows are compared as a sorted
//    list, across the `<script>` chunks they are cut into.
function comparable(body: string, segment: string): string {
  return body
    .replace(/<meta name="(?:sentry-trace|baggage)" content="[^"]*"\/>/g, "")
    .split(segment)
    .join("<asked>")
    .split('"])</script><script>self.__next_f.push([1,"')
    .join("")
    .split("\\n")
    .sort()
    .join("\n");
}

test("a private day and an unknown one are the same 404 with the same body", async ({ page, browser }) => {
  test.slow();
  const name = `Kept back ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, `Seoe2e${randomUUID().slice(0, 6)}`, name);
  await page.request.delete(`/api/saved-days/${savedDayId}/publish`);
  try {
    const visitor = await stranger(browser);
    const unknownId = randomUUID();
    const slug = sluggedPath(name, "").slice("/playbooks/day/".length, -1);
    const asked = {
      hidden: savedDayId,
      // With the slug it would have: a right guess at the name earns nothing.
      hiddenSlugged: `${slug}-${savedDayId}`,
      unknown: unknownId,
      unknownSlugged: `a-plausible-name-${unknownId}`,
      junk: "not-a-day",
    };
    const bodies: Record<string, string> = {};
    for (const [which, segment] of Object.entries(asked)) {
      const response = await visitor.request.get(`/playbooks/day/${segment}`, { maxRedirects: 0 });
      // 404, and in particular never a redirect: that would say the id exists.
      expect(response.status(), which).toBe(404);
      expect(response.headers().location, which).toBeUndefined();
      const body = await response.text();
      expect(body, which).not.toContain(name);
      bodies[which] = comparable(body, segment);
    }
    // Nor the name as a slug: with the asked-for segment taken out, no answer
    // may spell it, least of all the one that was asked by bare id.
    for (const which of Object.keys(asked)) expect(bodies[which], which).not.toContain(slug);
    for (const which of Object.keys(asked)) expect(bodies[which], which).toBe(bodies.unknown);

    // Its author still opens it.
    const mine = await page.request.get(`/playbooks/day/${savedDayId}`);
    expect(mine.status()).toBe(200);
    expect(await mine.text()).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

test("Discover's HTML lists a published day without JavaScript", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const name = `Listed day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  try {
    const visitor = await stranger(browser);
    const html = await (await visitor.request.get(`/playbooks?city=${encodeURIComponent(city)}`)).text();
    expect(html).toContain(name);
    expect(html).toContain(sluggedPath(name, savedDayId));
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

test("Discover hydrates from the server's list and makes no first search", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const name = `Listed day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  try {
    const visitor = await stranger(browser);
    const searches: string[] = [];
    visitor.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/playbooks") searches.push(request.url());
    });
    await visitor.goto(`/playbooks?city=${encodeURIComponent(city)}`);
    await expect(visitor.getByText(name).first()).toBeVisible();
    // Hydration has finished once a control only React answers does: opening
    // the Sort menu changes no search, and a click that lands before hydration
    // is lost, so it is retried until the menu is open. A first fetch is sent
    // from an effect on that same pass, so it has been sent by then.
    const sort = visitor.getByRole("button", { name: "Sort" });
    await expect(async () => {
      await sort.click();
      await expect(sort).toHaveAttribute("aria-expanded", "true", { timeout: 500 });
    }).toPass();
    expect(searches).toEqual([]);
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});
