import { useId } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";

export type NextTripPromptProps = {
  /** Opens the page's one new-trip flow — the same handler as the page-head "New trip". */
  onStart: () => void;
  /** Held shut for the same reason the page-head button is (a demo copy in flight). */
  disabled?: boolean;
};

// **What stands where *Other trips* would be, on a one-trip account** —
// Mitchell, PR #269 preview: *"I kinda want some placeholder below your main
// trip if you dont have any other trips, like a larger call to action let
// 'Lets start planning your next trip' and a secon button to start a new
// trip. This would only be the new account experience"*.
//
// Before this, a Home with exactly one trip drew the hero and then nothing:
// §35.2 filters the hero out of the grid, and an empty grid renders no heading
// either, so the page ended at the hero's bottom edge. This is the invitation
// to the second trip.
//
// **A button that runs the page's own handler, not a second flow.** It opens
// the same `NewTripWizard` the page head does, through the same
// `startNewTrip`, so there is one sheet and one set of rules about when it
// may open. Its accessible name is *Start a new trip*, not *New trip*, because
// the page-head button is still on screen above it: two buttons with one name
// would be indistinguishable to a screen reader and to any test that finds a
// control by its role and name.
//
// Not `EmptyState`: that is the dashed "this filter matched nothing" box, and
// FirstTripStart's note already says why an account's own trips are not an
// empty filter. A plain bordered region, centred, one step down the type scale
// from the hero it follows.
/**
 * The call to action Home shows under the next-trip hero when there are no other trips.
 *
 * @param onStart - Opens the page's new-trip flow
 * @param disabled - Holds the button shut while the page is busy
 * @returns A section inviting the reader to start another trip
 */
export function NextTripPrompt({ onStart, disabled = false }: NextTripPromptProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="next-trip-prompt"
      className="flex flex-col items-center gap-3 rounded-lg border border-hairline bg-surface px-6 py-10 text-center"
    >
      <Heading level={2} id={headingId}>
        Let&rsquo;s start planning your next trip
      </Heading>
      <Text as="p" variant="secondary" className="max-w-measure text-pretty">
        A name is enough to begin. Dates, days and the people coming along can all come later.
      </Text>
      <Button type="button" variant="primary" size="touch" className="mt-2" disabled={disabled} onClick={onStart}>
        <Plus className="size-4" aria-hidden />
        Start a new trip
      </Button>
    </section>
  );
}
