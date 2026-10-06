import type { ReactNode } from "react";
import type { TripCover } from "@tc/contracts";
import { cn } from "@/lib/cn";

// A cover photo, for a trip now and a playbook day next (M37 parts 4 and 5).
// Unsplash's guidelines are binding here: the image is HOTLINKED from the URL
// Unsplash returned, never copied or proxied (plan rule 1, D3) — so a plain
// `<img>`, not `next/image`, whose optimiser would fetch and re-serve it.
// Sizing uses the imgix parameters Unsplash documents on `urls.raw`, which is
// the one transformation the guidelines allow.

/** What a cover image needs: a `TripCover`, or a picker candidate, has all of it. */
export type CoverPhoto = Pick<TripCover, "urls" | "alt" | "photographerName">;

// Widths the browser may pick between. The card strip is ~360px CSS at most
// and the hero band ~700px, so 2x screens want up to 1400; 1600 covers a
// playbook day's full-bleed cover on a laptop.
const WIDTHS = [400, 800, 1200, 1600] as const;

/**
 * `raw` at `width` pixels, through imgix: cropped to fill, JPEG at q80. Appends
 * with `&` when the URL already has a query, as Unsplash's raw URLs do.
 */
export function coverSrc(raw: string, width: number): string {
  return `${raw}${raw.includes("?") ? "&" : "?"}w=${width}&q=80&fm=jpg&fit=crop`;
}

/** The image's alt text: Unsplash's description, else who took it (plan rule 8). */
export function coverAlt(photo: CoverPhoto): string {
  return photo.alt ?? `Photo by ${photo.photographerName}`;
}

/**
 * Where the photo dissolves into what is under the words. `strip` and `band`
 * fade into a card's surface (home's card and hero); `paper` into the page
 * (a playbook day). Each is a class in `globals.css`.
 */
export type CoverVeil = "strip" | "band" | "paper";

const VEIL_CLASS: Record<CoverVeil, string> = {
  strip: "cover-veil-strip",
  band: "cover-veil-band",
  paper: "cover-veil-paper",
};

/**
 * A fixed-height box filled by the cover photo, cropped to cover it, with an
 * optional veil and anything the caller lays over the top (a badge, a menu).
 * The caller sets the height in `className`, so the box never changes size
 * when the image arrives. Lazy unless `eager` — the hero and a playbook day's
 * cover, which are above the fold, are the eager callers; `priority` also asks
 * the browser to fetch it first, for the one image that is the page's largest.
 */
export function CoverImage({
  photo,
  className,
  sizes,
  veil,
  eager = false,
  priority = false,
  children,
}: {
  photo: CoverPhoto;
  /** The box's height (and anything else about the box). */
  className?: string;
  /** The `sizes` attribute: how wide the box renders, for picking a width. */
  sizes: string;
  veil?: CoverVeil;
  eager?: boolean;
  /** Eager and `fetchpriority="high"`: the page's largest image. */
  priority?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-moss", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked from Unsplash's CDN by its guidelines (D3); next/image would proxy it */}
      <img
        src={photo.urls.regular}
        srcSet={WIDTHS.map((w) => `${coverSrc(photo.urls.raw, w)} ${w}w`).join(", ")}
        sizes={sizes}
        alt={coverAlt(photo)}
        loading={eager || priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      {veil !== undefined && <div aria-hidden className={cn("absolute inset-0", VEIL_CLASS[veil])} />}
      {children}
    </div>
  );
}
