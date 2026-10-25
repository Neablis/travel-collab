"use client";

import { UNSPLASH_HOME, unsplashCreditHref, type TripCover } from "@tc/contracts";
import { cn } from "@/lib/cn";
import { coverImageSrc, useCoverShown } from "./CoverImage";

// Unsplash's guidelines (plan rule 3): wherever the photo appears, the
// photographer and Unsplash are both credited and both linked, with the
// referral parameters `unsplashCreditHref` adds. Text, never a logo (rule 5).
// Those rules are Unsplash's alone: a URL cover (M49) credits whoever the API
// named, if anyone, and never mentions Unsplash.

type UrlCover = Extract<TripCover, { source: "url" }>;

/** What a credit needs: a `TripCover`, or a picker candidate, has it. */
export type CoverCreditPhoto =
  | (Pick<Extract<TripCover, { source: "unsplash" }>, "urls" | "photographerName" | "photographerUrl"> & { source?: "unsplash" })
  | Pick<UrlCover, "source" | "credit" | "proxySrc">;

// The 44px phone floor (§13.1), released at `md`: on the #354 preview a
// credit link measured 61×15 at 390px. Inline-flex keeps it in the sentence.
const LINK = "inline-flex min-h-11 items-center text-slate underline-offset-2 hover:text-brand-pressed hover:underline fine:min-h-0";

/**
 * A URL cover's credit link, or `undefined` for plain text. Set through the
 * API and shown to everyone on the trip, so only an http(s) URL becomes a link.
 */
function creditHref(url: string | null): string | undefined {
  if (url === null || !URL.canParse(url)) return undefined;
  const { protocol } = new URL(url);
  return protocol === "https:" || protocol === "http:" ? url : undefined;
}

/**
 * "Photo by <name> on Unsplash", both linked, each opening a new tab. Small
 * and slate, so it reads as a caption under whatever the photo sits in. A URL
 * cover's is "Photo by <name>", linked when it has a link, and nothing when
 * it names no one. Nothing either while the photo is not on screen (no
 * `proxySrc`, or it failed to load): there is no photo to credit.
 */
export function CoverCredit({ photo, className }: { photo: CoverCreditPhoto; className?: string }) {
  const shown = useCoverShown(coverImageSrc(photo));
  if (!shown) return null;
  if (photo.source === "url") return photo.credit === null ? null : <UrlCredit credit={photo.credit} className={className} />;
  return (
    <p className={cn("text-xs text-slate", className)}>
      Photo by{" "}
      <a href={unsplashCreditHref(photo.photographerUrl)} target="_blank" rel="noopener" className={LINK}>
        {photo.photographerName}
      </a>{" "}
      on{" "}
      <a href={unsplashCreditHref(UNSPLASH_HOME)} target="_blank" rel="noopener" className={LINK}>
        Unsplash
      </a>
    </p>
  );
}

function UrlCredit({ credit, className }: { credit: NonNullable<UrlCover["credit"]>; className?: string }) {
  const href = creditHref(credit.url);
  return (
    <p className={cn("text-xs text-slate", className)}>
      Photo by{" "}
      {href === undefined ? (
        <span>{credit.name}</span>
      ) : (
        // `noreferrer`: the trip's address is not the credited site's business (ADR-081).
        <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
          {credit.name}
        </a>
      )}
    </p>
  );
}
