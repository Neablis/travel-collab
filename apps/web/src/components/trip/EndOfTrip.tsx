"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { AddSavedDayButton } from "@/components/trip/AddSavedDayButton";

// Phase 6's end-of-trip block: the plan's terminal affordance. "Add a day" is
// a real command (contracts' AddDay) — the caller raises it — and "Add a saved
// day" opens the real library (M11 link 6's AddSavedDayButton).
//
// **M11b deleted the three Playbook shortcut cards that used to sit below.**
// They were `<Preview id="insert-playbook">` over `PREVIEW_PLAYBOOK_CARDS` —
// six fabricated days with invented use counts — and the milestone's line is
// that the four Playbooks shells are deleted rather than re-pointed. What
// replaces them is a link to the real thing: Discover, over days people have
// actually published. A shortcut grid of real days would need this component to
// fetch the library, which is a page's job and not a footer's.
export function EndOfTrip({ onAddDay }: { onAddDay: () => void }) {
  return (
    <section
      data-testid="end-of-trip"
      className="flex flex-col gap-4 rounded-xl border border-dashed border-border-strong p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading level={3}>End of the trip</Heading>
          <Text variant="secondary" className="mt-1">
            Add another day, or drop in a day you have already planned — the times reflow to fit.
          </Text>
          <Text variant="secondary" className="mt-1">
            Or take one from{" "}
            <Link href="/playbooks" className="font-semibold text-brand hover:underline">
              other people&apos;s days
            </Link>
            .
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddSavedDayButton />
          <Button variant="primary" onClick={onAddDay}>
            Add a day
          </Button>
        </div>
      </div>
    </section>
  );
}
