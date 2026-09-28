import { z } from "zod";

/**
 * The text beside a per-link preview card (spec 2026-09-27 §2.2): what
 * `GET /api/og/invite/:token/meta` and `GET /api/og/referral/:code/meta` answer,
 * and what a page's `generateMetadata` turns into og:title and og:description.
 *
 * `.strict()`: these routes are public, and the card's privacy rule is first
 * names only. A field added here is a field a stranger reads, so an unexpected
 * one fails the parse rather than riding along.
 */
export const LinkPreviewMeta = z
  .object({
    title: z.string().min(1),
    description: z.string(),
  })
  .strict();
export type LinkPreviewMeta = z.infer<typeof LinkPreviewMeta>;
