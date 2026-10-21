import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { DATABASE_URL } from "../src/server/config";
import { expect, test } from "./fixtures/test";
import { forget, publishedDay, stranger } from "./helpers";

// The SEO pass's one script (spec 2026-10-02-seo-pass §6). What a crawler
// receives is the server's HTML, so most of this reads responses rather than
// driving a page.

// The headline as an element, not as text: the site description in every
// page's <head> opens with the same words.
const HEADLINE = /Plan the trip together\.<\/h[12]>/;

test("a signed-out / serves the landing in place, cacheable, with one h1", async ({ browser }) => {
  const visitor = await stranger(browser);
  const response = await visitor.request.get("/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  // ADR-078: `/` is one static page for everybody, so a CDN, the browser and
  // the back-forward cache may all keep it. It was `private, no-store` while
  // it was two pages by session.
  const cacheControl = response.headers()["cache-control"] ?? "";
  expect(cacheControl).not.toMatch(/private|no-store/);
  const html = await response.text();
  expect(html).toMatch(HEADLINE);
  // The phone and desktop trees are both in the document; only one may be an h1.
  expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
  // The root's canonical is the bare origin: Next drops the trailing slash.
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
  expect(new URL(canonical).pathname).toBe("/");
  expect(html).toContain('"@type":"Organization"');
  await visitor.context().close();
});

// A signed-in `/` going on to `/home` is e2e/m15-front-door.spec.ts's, beside
// the sign-out half of the same hint (ADR-078).

test("/welcome, the landing's old address, is a permanent redirect to /", async ({ browser }) => {
  const visitor = await stranger(browser);
  const response = await visitor.request.get("/welcome", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location ?? "", "http://x").pathname).toBe("/");
  await visitor.context().close();
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

  // A search that is not one indexed place is Discover itself: the canonical
  // drops the query string. A city nobody published in, so another spec's days
  // cannot tip it over the threshold mid-run.
  const playbooks = await head(`/playbooks?city=Nowheree2e${randomUUID().slice(0, 8)}`);
  expect(playbooks).toMatch(/<link rel="canonical" href="[^"]*\/playbooks"/);
  // /playbooks passes the Playbooks card as its `image`; twitter states no
  // images of its own, so it must inherit that card. The site card is also
  // a twitter:image, so the match is on the card's path, not mere presence.
  expect(playbooks).toMatch(/<meta name="twitter:image" content="[^"]*\/api\/og\/playbooks/);

  const demo = await head("/demo");
  expect(demo).toMatch(/<meta name="description" content="[^"]{10,}"/);
  const title = /<title>([^<]*)<\/title>/.exec(demo)?.[1] ?? "";
  expect(title).toContain("Example trips");
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
    // Each demo trip is a public page with no database behind it (M42 D1).
    const demos = ["/demo/japan", "/demo/dolomites-winter", "/demo/iceland-ring-road", "/demo/northern-spain", "/demo/thailand-andaman"];
    for (const path of ["/", "/playbooks", "/demo", ...demos, "/developers", "/developers/reference"]) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]*${path}</loc>`));
    }
    // By its slugged URL, the one the day page answers 200 on: a bare id
    // here would hand a crawler a redirect for every day.
    expect(xml).toMatch(new RegExp(`<loc>[^<]*/playbooks/day/listed-${city.toLowerCase()}-${publishedId}</loc>`));
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

// Every `application/ld+json` block in a page, parsed and flattened.
const ldJson = (html: string): unknown[] =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((m) => JSON.parse(m[1]!) as unknown);

const itemLists = (html: string) =>
  ldJson(html).filter((n) => (n as { "@type": string })["@type"] === "ItemList") as {
    itemListElement: { url: string; name: string }[];
  }[];

// The paths of a page's one top-level `ItemList`, sorted; each URL must be absolute to parse.
const itemListPaths = (html: string): string[] => {
  const [list, ...rest] = itemLists(html);
  expect(rest, "one ItemList").toEqual([]);
  expect(list, "an ItemList").toBeDefined();
  return list!.itemListElement.map((item) => new URL(item.url).pathname).sort();
};

// The page's meta description as text: React escapes `&`, `"`, `'`, `<` and `>`
// in an attribute, and the JSON-LD copy of the same sentence is not escaped.
const metaDescription = (html: string): string | undefined =>
  /<meta name="description" content="([^"]*)"/
    .exec(html)?.[1]
    ?.replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

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
    // Structured data: the trip and its breadcrumb, describing the day in the
    // words its meta description already uses.
    const nodes = ldJson(html) as { "@type": string; name?: string; description?: string }[];
    expect(nodes.map((n) => n["@type"])).toEqual(expect.arrayContaining(["TouristTrip", "BreadcrumbList"]));
    const trip = nodes.find((n) => n["@type"] === "TouristTrip");
    expect(trip?.name).toBe(name);
    const description = metaDescription(html);
    expect(description).toBeTruthy();
    expect(trip?.description).toBe(description);
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

// A 404 body as what it says, so two of them can be compared for what they
// tell a visitor, with what belongs to the REQUEST taken out: Sentry's
// `sentry-trace` and `baggage` metas (a random trace id per request) and the
// path that was asked for, which Next echoes back. Two halves:
//  - The HTML with every `<script>` taken out, compared as it is.
//  - Every string in Next's flight payload, where the page's metadata streams
//    (its <title> among them), as a sorted set. Not the payload's bytes: its
//    rows are numbered and inlined as they resolve and cut into chunks as
//    bytes flush, so two 404s that say the same thing differ there by timing
//    and by the size of anything upstream (KI-2026-10-18-e: 84 bytes in the
//    root layout, or a shorter asked-for path, turned that red with no privacy
//    change). A reference to a row (`"$1"`, `"$L1a"`, `"$@2"`) is numbering
//    too, and comes out; a `$` string that carries a value (a date as `"$D…"`,
//    a bigint, a symbol, an escaped `"$$…"`) stays in, or a leaked one would
//    pass.
const FLIGHT_PUSH = "self.__next_f.push(";
const ROW_REFERENCE = /^"\$[A-Z@]?[0-9a-f]+"$/;
function said(body: string, segment: string): string {
  const asked = body
    .replace(/<meta name="(?:sentry-trace|baggage)" content="[^"]*"\/>/g, "")
    .split(segment)
    .join("<asked>");
  // Cut on the exact tags the page emits rather than matching elements with a
  // pattern: every `<script…>` up to its `</script>` comes out of the HTML,
  // and the inline ones that push a flight chunk (`[1, "<chunk>"]`) give it up.
  let html = "";
  let payload = "";
  let at = 0;
  for (let open = asked.indexOf("<script", at); open !== -1; open = asked.indexOf("<script", at)) {
    const start = asked.indexOf(">", open) + 1;
    const end = asked.indexOf("</script>", start);
    expect(start > 0 && end !== -1, "a <script> the page closes").toBe(true);
    html += asked.slice(at, open);
    const script = asked.slice(start, end);
    if (script.startsWith(FLIGHT_PUSH)) {
      const [kind, chunk] = JSON.parse(script.slice(FLIGHT_PUSH.length, -1)) as [number, unknown];
      if (kind === 1) payload += chunk as string;
    }
    at = end + "</script>".length;
  }
  html += asked.slice(at);
  const strings = new Set((payload.match(/"(?:[^"\\]|\\.)*"/g) ?? []).filter((string) => !ROW_REFERENCE.test(string)));
  return `${html}\n\n${[...strings].sort().join("\n")}`;
}

test("a private day and an unknown one are the same 404 with the same body", async ({ page, browser }) => {
  test.slow();
  const name = `Kept back ${randomUUID().slice(0, 8)}`;
  // Unique, and in the day's one stop's title and place.
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const savedDayId = await publishedDay(page, city, name);
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
      // The whole body, flight payload and all: neither the day's name nor
      // anything on it.
      const body = await response.text();
      expect(body, which).not.toContain(name);
      expect(body, which).not.toContain(city);
      // Nor the name as a slug: with the asked-for segment taken out, no
      // answer may spell it, least of all the one that was asked by bare id.
      expect(body.split(segment).join("<asked>"), which).not.toContain(slug);
      bodies[which] = said(body, segment);
    }
    // Each hidden day against the unknown one asked the same way, page for
    // page. The URL's shape picks which copy answers (`lib/playbooksReader.ts`:
    // a bare id is answered live, a slugged one cached). Existence never picks
    // the copy, so this is the claim.
    expect(bodies.hidden, "hidden").toBe(bodies.unknown);
    expect(bodies.hiddenSlugged, "hiddenSlugged").toBe(bodies.unknownSlugged);
    expect(bodies.junk, "junk").toBe(bodies.unknown);

    // Its author still opens it.
    const mine = await page.request.get(`/playbooks/day/${savedDayId}`);
    expect(mine.status()).toBe(200);
    const own = await mine.text();
    expect(own).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
    // A private day describes itself to nobody, its author's page included.
    expect(ldJson(own)).toEqual([]);
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

// ADR-077: a stranger's day page is the cached copy, the same answer from the
// cache on the second ask, while its author at the same URL is answered live.
// `x-nextjs-cache` is `next start`'s own report of which it served.
test("a stranger's day page comes from the cache, its author's never does", async ({ page, browser }) => {
  test.slow();
  const name = `Cache split ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, `Seoe2e${randomUUID().slice(0, 6)}`, name);
  try {
    const visitor = await stranger(browser);
    const path = sluggedPath(name, savedDayId);
    expect((await visitor.request.get(path)).status()).toBe(200);
    const again = await visitor.request.get(path);
    expect(again.status()).toBe(200);
    expect(again.headers()["x-nextjs-cache"]).toBe("HIT");

    const mine = await page.request.get(path);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["x-nextjs-cache"]).toBeUndefined();
    expect(mine.headers()["cache-control"]).toContain("no-store");
    await visitor.context().close();
  } finally {
    await forget(page, savedDayId);
  }
});

// A `Client` per call, `m11a-invite-gate.spec.ts`'s construction: the app's
// pooled `db` would hold the worker's event loop open. `saved_days` is CRUD,
// not the planning log, so this is fixture setup rather than a second write path.
async function renameBehindTheCache(savedDayId: string, name: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("update saved_days set name = $1 where id = $2", [name, savedDayId]);
  } finally {
    await client.end();
  }
}

// ADR-063: a stranger's read of a day is cached for a day, on this production
// build as on Vercel. Unpublishing has to take it out at once, and
// republishing has to put it back, or the cache is a way to see a withdrawn day.
test("a day a stranger has read leaves the moment it is unpublished, and returns when republished", async ({
  page,
  browser,
}) => {
  test.slow();
  const name = `Cached day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, `Seoe2e${randomUUID().slice(0, 6)}`, name);
  try {
    const visitor = await stranger(browser);
    const path = sluggedPath(name, savedDayId);
    expect((await visitor.request.get(path)).status()).toBe(200);
    // Renamed behind the app's back, which clears nothing: the visitor still
    // reading the old name is what proves the next answer is the cached one.
    await renameBehindTheCache(savedDayId, `Renamed ${name}`);
    const cached = await visitor.request.get(path, { maxRedirects: 0 });
    expect(cached.status()).toBe(200);
    expect(await cached.text()).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));

    expect((await page.request.delete(`/api/saved-days/${savedDayId}/publish`)).ok()).toBe(true);
    const withdrawn = await visitor.request.get(path, { maxRedirects: 0 });
    expect(withdrawn.status()).toBe(404);
    expect(await withdrawn.text()).not.toContain(name);

    expect((await page.request.post(`/api/saved-days/${savedDayId}/publish`)).ok()).toBe(true);
    expect((await visitor.request.get(path)).status()).toBe(200);
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
    // `scope=saved` and a padded city: a stranger reads Everyone, and the
    // API's own trim applies, so the server's list is still the right one.
    await visitor.goto(`/playbooks?scope=saved&city=${encodeURIComponent(` ${city}`)}`);
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

// Whether a thin place page is indexed is not asserted here: off production
// every page is `noindex` (`siteRobots`), so the threshold is proven against
// the metadata builder in `server/placePage.int.test.ts`.
test("a city page lists its days in the HTML and, once indexable, as an ItemList; an unknown city or page is a 404", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const name = `City page day ${randomUUID().slice(0, 8)}`;
  const savedDayId = await publishedDay(page, city, name);
  const ids = [savedDayId];
  const names = [name];
  try {
    const visitor = await stranger(browser);
    const path = `/playbooks/city/${city.toLowerCase()}`;
    const response = await visitor.request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`>${city} playbooks</h1>`));
    expect(html).toContain(sluggedPath(name, savedDayId));
    expect(html).toMatch(new RegExp(`<link rel="canonical" href="[^"]*${path}"`));

    // The day links back to its city, in its title block and in its breadcrumb.
    const dayHtml = await (await visitor.request.get(sluggedPath(name, savedDayId))).text();
    expect(dayHtml).toContain(`href="${path}"`);
    const crumbs = ldJson(dayHtml).find((n) => (n as { "@type": string })["@type"] === "BreadcrumbList") as {
      itemListElement: { name: string; item: string }[];
    };
    expect(crumbs.itemListElement.map((c) => [c.name, new URL(c.item).pathname])).toContainEqual([city, path]);

    // One published day is below the threshold, so Discover's search for the
    // city stays canonical to Discover: a canonical naming a `noindex` page
    // would leave neither in the index.
    const discover = await (await visitor.request.get(`/playbooks?city=${city}`)).text();
    expect(discover).toMatch(/<link rel="canonical" href="[^"]*\/playbooks"/);

    expect((await visitor.request.get("/playbooks/city/no-such-city-anywhere")).status()).toBe(404);
    expect((await visitor.request.get(`${path}?page=9`)).status()).toBe(404);

    // A thin page is noindex and describes nothing to a crawler.
    expect(itemLists(html)).toEqual([]);
    for (const more of ["two", "three"]) {
      ids.push(await publishedDay(page, city, `${name} ${more}`));
      names.push(`${name} ${more}`);
    }
    // At the threshold it lists every day, from the cached copy a stranger is served.
    expect(itemListPaths(await (await visitor.request.get(path)).text())).toEqual(
      names.map((n, i) => sluggedPath(n, ids[i]!)).sort(),
    );
    await visitor.context().close();
  } finally {
    await Promise.all(ids.map((id) => forget(page, id)));
  }
});

test("a country page lists its days as one ItemList of absolute URLs", async ({ page, browser }) => {
  test.slow();
  const city = `Seoe2e${randomUUID().slice(0, 6)}`;
  const names = ["one", "two", "three"].map((n) => `Country page day ${randomUUID().slice(0, 8)} ${n}`);
  const ids: string[] = [];
  try {
    // Nauru: a country no other spec publishes in, so the page holds these days alone.
    for (const name of names) ids.push(await publishedDay(page, city, name, [], "NR"));
    const visitor = await stranger(browser);
    const response = await visitor.request.get("/playbooks/country/nauru");
    expect(response.status()).toBe(200);
    expect(itemListPaths(await response.text())).toEqual(names.map((n, i) => sluggedPath(n, ids[i]!)).sort());
    await visitor.context().close();
  } finally {
    await Promise.all(ids.map((id) => forget(page, id)));
  }
});
