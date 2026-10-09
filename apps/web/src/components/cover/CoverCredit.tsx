import { UNSPLASH_HOME, unsplashCreditHref, type TripCover } from "@tc/contracts";
import { cn } from "@/lib/cn";

// Unsplash's guidelines (plan rule 3): wherever the photo appears, the
// photographer and Unsplash are both credited and both linked, with the
// referral parameters `unsplashCreditHref` adds. Text, never a logo (rule 5).

/** What a credit needs: a `TripCover`, or a picker candidate, has both. */
export type CoverCreditPhoto = Pick<TripCover, "photographerName" | "photographerUrl">;

// The 44px phone floor (§13.1), released at `md`: on the #354 preview a
// credit link measured 61×15 at 390px. Inline-flex keeps it in the sentence.
const LINK = "inline-flex min-h-11 items-center text-slate underline-offset-2 hover:text-brand-pressed hover:underline fine:min-h-0";

/**
 * "Photo by <name> on Unsplash", both linked, each opening a new tab. Small
 * and slate, so it reads as a caption under whatever the photo sits in.
 */
export function CoverCredit({ photo, className }: { photo: CoverCreditPhoto; className?: string }) {
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
