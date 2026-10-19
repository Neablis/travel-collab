import type { ReactNode } from "react";
import { preload } from "react-dom";
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

/**
 * A transparent 1px GIF, inline: what a phone's `<source>` picks instead of the
 * photo when `notOnPhone` is set, so it requests nothing.
 */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** The phone line, as `lib/useIsPhone.ts` and Tailwind's `md:` draw it: below 768px. */
const PHONE_MEDIA = "(max-width: 767px)";
/** Its complement: where a `notOnPhone` photo is shown, and so preloaded. */
const ABOVE_PHONE_MEDIA = "(min-width: 768px)";

/**
 * The image's alt text: Unsplash's description, else who took it (plan rule
 * 8). `||`, not `??`: Unsplash sends `""` for a photo with no description.
 */
export function coverAlt(photo: CoverPhoto): string {
  return photo.alt || `Photo by ${photo.photographerName}`;
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
  notOnPhone = false,
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
  /**
   * The box is hidden on a phone, so a phone must not download the photo
   * either: a hidden `<img>` is still fetched, and an eager one first. Wraps
   * it in a `<picture>` whose phone `<source>` is a blank inline GIF. The
   * caller still hides the box (`max-md:hidden`).
   *
   * React preloads an eager `<img>` itself, but not one inside a `<picture>`
   * (its source may differ), so a `priority` photo here is preloaded by hand,
   * with the media query that keeps a phone from fetching it.
   */
  notOnPhone?: boolean;
  children?: ReactNode;
}) {
  const srcSet = WIDTHS.map((w) => `${coverSrc(photo.urls.raw, w)} ${w}w`).join(", ");
  if (notOnPhone && priority) {
    preload(photo.urls.regular, {
      as: "image",
      imageSrcSet: srcSet,
      imageSizes: sizes,
      fetchPriority: "high",
      media: ABOVE_PHONE_MEDIA,
    });
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked from Unsplash's CDN by its guidelines (D3); next/image would proxy it
    <img
      src={photo.urls.regular}
      srcSet={srcSet}
      sizes={sizes}
      alt={coverAlt(photo)}
      loading={eager || priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="absolute inset-0 size-full object-cover"
    />
  );
  return (
    <div className={cn("relative overflow-hidden bg-moss", className)}>
      {notOnPhone ? (
        <picture>
          <source media={PHONE_MEDIA} srcSet={BLANK} />
          {img}
        </picture>
      ) : (
        img
      )}
      {veil !== undefined && <div aria-hidden className={cn("absolute inset-0", VEIL_CLASS[veil])} />}
      {children}
    </div>
  );
}
