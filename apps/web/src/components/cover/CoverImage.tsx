"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { preload } from "react-dom";
import type { TripCover } from "@tc/contracts";
import { cn } from "@/lib/cn";

// A cover photo, for a trip now and a playbook day next (M37 parts 4 and 5).
// Unsplash's guidelines are binding here: the image is HOTLINKED from the URL
// Unsplash returned, never copied or proxied (plan rule 1, D3) — so a plain
// `<img>`, not `next/image`, whose optimiser would fetch and re-serve it.
// Sizing uses the imgix parameters Unsplash documents on `urls.raw`, which is
// the one transformation the guidelines allow.
//
// A URL cover (M49, ADR-081) is the exception to all of that: it is read from
// our own origin, through `proxySrc`, so no third-party host sees a viewer.
// It has no imgix to size it, so it is one `src` and no `srcset`.

type UnsplashCover = Extract<TripCover, { source: "unsplash" }>;
type UrlCover = Extract<TripCover, { source: "url" }>;

/**
 * What a cover image needs: a `TripCover` has all of it, and so does a picker
 * candidate, which is an Unsplash photo with no `source` or `position` yet.
 */
export type CoverPhoto =
  | (Pick<UnsplashCover, "urls" | "alt" | "photographerName"> & { source?: "unsplash"; position?: number })
  | Pick<UrlCover, "source" | "alt" | "position" | "proxySrc">;

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

/** The src a cover's `<img>` loads, or `undefined` when it has none to load. */
export function coverImageSrc(
  photo: { source?: "unsplash"; urls: { regular: string } } | { source: "url"; proxySrc?: string },
): string | undefined {
  return photo.source === "url" ? photo.proxySrc : photo.urls.regular;
}

// Srcs whose last request failed. Shared rather than one image's state, so the
// credit, which sits elsewhere on each surface, hides with the photo it
// credits (decision 7). Most failures are a dropped connection, not a deleted
// photo, so a src is forgotten as soon as any image of it loads, and every
// failure is forgotten when the browser comes back online. Only a browser
// event writes it, so a server render always shows the photo.
const failedSrcs = new Set<string>();
const failListeners = new Set<() => void>();

function notifyFailures() {
  for (const listener of failListeners) listener();
}

function markFailed(src: string | undefined) {
  if (src === undefined || failedSrcs.has(src)) return;
  failedSrcs.add(src);
  notifyFailures();
}

function markLoaded(src: string | undefined) {
  if (src === undefined || !failedSrcs.delete(src)) return;
  notifyFailures();
}

function forgetFailures() {
  if (failedSrcs.size === 0) return;
  failedSrcs.clear();
  notifyFailures();
}

function subscribeToFailures(listener: () => void) {
  if (failListeners.size === 0) window.addEventListener("online", forgetFailures);
  failListeners.add(listener);
  return () => {
    failListeners.delete(listener);
    if (failListeners.size === 0) window.removeEventListener("online", forgetFailures);
  };
}

/** Whether a cover's photo is on screen: it has a src to load, and that src has not failed. */
export function useCoverShown(src: string | undefined): boolean {
  const failed = useSyncExternalStore(
    subscribeToFailures,
    () => src !== undefined && failedSrcs.has(src),
    () => false,
  );
  return src !== undefined && !failed;
}

/**
 * The image's alt text: Unsplash's description, else who took it (plan rule
 * 8). `||`, not `??`: Unsplash sends `""` for a photo with no description.
 */
export function coverAlt(photo: CoverPhoto): string {
  if (photo.source === "url") return photo.alt ?? "";
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
 * A fixed-height box filled by the cover photo, cropped to cover it and framed
 * at its `position`, with an optional veil and anything the caller lays over
 * the top (a badge, a menu). The caller sets the height in `className`, so the
 * box never changes size when the image arrives — nor when it never does: a
 * photo that fails to load, or a URL cover with no `proxySrc`, leaves the
 * plain box with its veil and overlays, as it looks before the photo arrives
 * (decision 7). Lazy unless `eager` — the hero and a playbook day's
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
  const url = photo.source === "url";
  const src = coverImageSrc(photo);
  const shown = useCoverShown(src);
  // Whether this copy's own request failed, and how often it has asked again.
  // A broken element holds its failed request and asks for nothing more, so
  // once the src is forgotten it is keyed afresh; a copy that never failed,
  // such as the one whose load forgot it, keeps its element.
  const [broken, setBroken] = useState(false);
  const [retry, setRetry] = useState(0);
  if (broken && shown) {
    setBroken(false);
    setRetry(retry + 1);
  }
  const fail = () => {
    setBroken(true);
    markFailed(src);
  };
  const srcSet = url ? undefined : WIDTHS.map((w) => `${coverSrc(photo.urls.raw, w)} ${w}w`).join(", ");
  if (notOnPhone && priority && src !== undefined) {
    preload(src, {
      as: "image",
      imageSrcSet: srcSet,
      imageSizes: srcSet === undefined ? undefined : sizes,
      fetchPriority: "high",
      media: ABOVE_PHONE_MEDIA,
    });
  }
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked from Unsplash's CDN by its guidelines (D3), or already same-origin through the cover proxy; next/image would proxy it
    <img
      key={retry}
      src={src}
      srcSet={srcSet}
      sizes={srcSet === undefined ? undefined : sizes}
      alt={coverAlt(photo)}
      loading={eager || priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      // A phone's blank stand-in loading says nothing about the photo.
      onLoad={(e) => {
        if (e.currentTarget.currentSrc !== BLANK) markLoaded(src);
      }}
      onError={fail}
      // A server-rendered image can fail before hydration, and React attaches
      // `onError` only then, without replaying it: check once it is ours. Only
      // a requested image has a `currentSrc`, so a lazy one the browser has
      // deferred is never taken for a broken one.
      ref={(el) => {
        if (!broken && el?.complete && el.naturalWidth === 0 && el.currentSrc !== "") fail();
      }}
      // A failed photo stays in the box, hidden, so that mounting it again
      // asks again, and its `load` brings it and its credit back.
      aria-hidden={shown ? undefined : true}
      // eslint-disable-next-line no-restricted-syntax -- the cover's stored framing, 0–100 per photo (M49 decision 9): data, not a style a token could name
      style={{ objectPosition: `center ${photo.position ?? 50}%` }}
      className={cn("absolute inset-0 size-full object-cover", !shown && "invisible")}
    />
  );
  return (
    <div className={cn("relative overflow-hidden bg-moss", className)}>
      {src === undefined ? null : notOnPhone ? (
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
