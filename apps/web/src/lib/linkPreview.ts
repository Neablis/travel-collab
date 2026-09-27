import type { Metadata } from "next";
import { deploymentOrigin } from "./deploymentOrigin";
import { pageMetadata } from "./siteMetadata";

// The page half of the per-link preview cards (spec 2026-09-27 §2.2). A page
// file cannot import `@/server` (AGENTS.md's lint wall), so its
// `generateMetadata` asks the card's `meta` route over HTTP for the title and
// description — the same lookup the image route draws from — and points
// og:image at the image route.
//
// **Absolute, from `deploymentOrigin()`**: a server component has no relative
// base to fetch against. On a protected Vercel preview that request is
// challenged rather than served, so previews fall back to the page's own
// metadata; production is not protected.
//
// **Any failure falls back**, never throws: a slow or broken lookup must cost
// the unfurl its personal card, not the page its render. Three seconds, because
// an unfurler waits for the whole <head>.
const META_TIMEOUT_MS = 3000;

/**
 * Metadata for a link with its own preview card: og:image at `imagePath`, the
 * title and description from `imagePath + "/meta"`, and `fallback` whenever
 * that lookup does not answer 200 with both strings.
 */
export async function linkPreviewMetadata(imagePath: string, fallback: Metadata): Promise<Metadata> {
  try {
    // eslint-disable-next-line no-restricted-globals -- a server-side generateMetadata call to an absolute deploymentOrigin() URL, which apiClient's browser-origin apiUrl() cannot build; this function never rejects either
    const response = await fetch(new URL(`${imagePath}/meta`, deploymentOrigin()), {
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return fallback;
    const { title, description } = body as Record<string, unknown>;
    if (typeof title !== "string" || typeof description !== "string") return fallback;
    // The card's sentence is og:title; the tab keeps the page's own <title>,
    // so the preview changes what an unfurler prints and nothing a visitor
    // sees. `absolute` only stops the template suffixing og:title's twin.
    const card = pageMetadata({ title: { absolute: title }, description, image: { url: imagePath, alt: title } });
    return { ...card, title: fallback.title ?? card.title };
  } catch {
    return fallback;
  }
}
