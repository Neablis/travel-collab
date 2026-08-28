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

// The landing hero (LandingScreen.tsx), headline + sub, joined.
export const SITE_DESCRIPTION =
  "The trip everyone actually helped plan. One shared plan your whole group " +
  "can move around — days, times, costs, who's in.";

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
  alt: "Caesura — the trip everyone actually helped plan. A day-column trip board beside the wordmark.",
};

export function pageMetadata({
  title,
  description,
}: {
  // A plain string composes with the layout's `%s — Caesura` template; pass
  // `{ absolute }` for a page that owns its whole <title>.
  title: string | { absolute: string };
  description: string;
}): Metadata {
  const ogTitle = typeof title === "string" ? title : title.absolute;
  return {
    title,
    description,
    openGraph: {
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      // og:title stays suffix-free — og:site_name already carries the brand,
      // and share cards render both.
      title: ogTitle,
      description,
      images: [OG_IMAGE],
    },
  };
}
