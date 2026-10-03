import type { Metadata } from "next";

// The site-wide strings the <head> metadata is built from, and the one
// helper page-level metadata goes through.
//
// Why a helper instead of each page exporting its own `openGraph` block:
// Next merges parent/child metadata *shallowly* — a page that sets
// `openGraph: { title }` silently drops the layout's siteName/type/locale
// on that page. Routing every page through here keeps the shared fields
// present everywhere and the page files down to the two strings that
// actually differ.
//
// Copy note: descriptions reuse the landing/auth surfaces' own copy where
// one exists (SPEC §14 makes the design handoff the source of product
// copy); only strings with no on-screen counterpart are authored here.

export const SITE_NAME = "Caesura";

// The landing hero (LandingScreen.tsx), headline + the sub's first sentence,
// joined.
export const SITE_DESCRIPTION =
  "Put the best day on repeat. Caesura is a trip planner built on playbooks: " +
  "real days from real trips, saved by the people who lived them.";

// The committed card next to the root layout (src/app/opengraph-image.png —
// regenerate with scripts/generate-og-assets.mjs). The file convention
// serves this route and injects og:image on segments that define no
// `openGraph` of their own, but a segment-level `openGraph` export replaces
// the whole resolved object *including* those file-derived images (verified
// against a production build, not just read from the docs) — so
// pageMetadata() has to restate the image. Kept in sync with
// opengraph-image.alt.txt, which covers the file-convention side.
const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "Caesura — put the best day on repeat. A day-column trip board beside the wordmark.",
};

/** Robots metadata for a page that must stay out of every index and pass no links. */
export const NOINDEX = { index: false, follow: false } as const;

/** Robots metadata for a page that stays out of the index but whose links are followed. */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;

/**
 * The root layout's robots value: nothing in production, `noindex` everywhere
 * else. A preview is kept out of the index here rather than by `robots.txt`,
 * because a disallowed URL is never crawled and so its `noindex` is never read.
 */
export function siteRobots(): typeof NOINDEX | undefined {
  return process.env.VERCEL_ENV === "production" ? undefined : NOINDEX;
}

/** The `Metadata` for one page: title, description, share card, and optionally canonical and robots. */
export function pageMetadata({
  title,
  cardTitle,
  description,
  image,
  canonical,
  robots,
}: {
  // A plain string composes with the layout's `%s — Caesura` template; pass
  // `{ absolute }` for a page that owns its whole <title>.
  title: string | { absolute: string };
  // og:title and twitter:title, for a page whose <title> says more than its
  // card should: a day's tab is "name · city", its card the bare name, over a
  // facts line that already names the city. Defaults to the title.
  cardTitle?: string;
  description: string;
  // A card drawn for this one link (spec 2026-09-27 §2.2, `/api/og/**`). It
  // goes FIRST, and the site card stays after it as the fallback for an
  // unfurler that cannot fetch the first.
  image?: { url: string; alt: string };
  // The path a search engine should index this page under, relative to
  // `metadataBase`. Also og:url, so a shared link and the index agree.
  canonical?: string;
  robots?: Metadata["robots"];
}): Metadata {
  const ogTitle = cardTitle ?? (typeof title === "string" ? title : title.absolute);
  return {
    title,
    description,
    ...(canonical === undefined ? {} : { alternates: { canonical } }),
    ...(robots === undefined ? {} : { robots }),
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      // og:title stays suffix-free — og:site_name already carries the brand,
      // and share cards render both.
      title: ogTitle,
      description,
      ...(canonical === undefined ? {} : { url: canonical }),
      images: image === undefined ? [OG_IMAGE] : [{ ...image, width: 1200, height: 630 }, OG_IMAGE],
    },
    // Stated rather than left to Next's inheritance from openGraph, so a
    // framework change cannot alter what a card shows.
    twitter: { card: "summary_large_image", title: ogTitle, description },
  };
}
