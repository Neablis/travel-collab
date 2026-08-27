"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Preview } from "@/components/ui/preview";
import { Text } from "@/components/ui/text";
import { PREVIEW_PLAYBOOK_CARDS } from "@/components/playbooks/preview-fixtures";
import { AddSavedDayButton } from "@/components/trip/AddSavedDayButton";

// Phase 6's end-of-trip block: the plan's terminal affordance. "Add a day" is
// a real command (contracts' AddDay) — the caller raises it — while "Add a
// saved day" and the Playbook shortcuts beside it are M11's insert-a-Playbook
// flow and stay inside <Preview id="insert-playbook">, which the Wave-1
// registry already carries.
//
// M11 link 6 made AddSavedDayButton real, so this block mounts it instead of
// drawing its own inert copy. It sits OUTSIDE the <Preview id="insert-playbook">
// below on purpose: that shell still carries the Playbook shortcuts, which are
// M11's separate Playbooks scope and are not built, and a real control inside a
// Preview would be shielded from every click. Two Previews are no longer a
// concern — AddSavedDayButton no longer wraps itself in one.
//
// Deliberately NOT reusing playbooks/PlaybookCard.tsx either: that card is a
// full detail surface (72px shape strip, three preview rows, tag pills, a
// footer with Share / Add to trip). Three of them side by side would be taller
// than the trip day above them and would read as the page's main content
// rather than a shortcut off the end of it. The compact shortcut below shows
// the three fields a chooser actually needs — city, name, and the span line —
// from the same PREVIEW_PLAYBOOK_CARDS fixture, so nothing here is fabricated.
const SHORTCUT_COUNT = 3;

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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddSavedDayButton />
          <Button variant="primary" onClick={onAddDay}>
            Add a day
          </Button>
        </div>
      </div>

      {/* size="container": a whole region, not a single control — the dotted
          border plus the "Preview · M11" chip. The shield inside Preview
          swallows every click below, so neither the button nor the shortcuts
          need (or get) an onClick. */}
      <Preview id="insert-playbook" size="container" className="p-4">
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {PREVIEW_PLAYBOOK_CARDS.slice(0, SHORTCUT_COUNT).map((playbook) => (
              <Card
                key={playbook.id}
                data-testid={`playbook-shortcut-${playbook.id}`}
                className="flex flex-col gap-1 rounded-lg p-2.5"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate">{playbook.city}</span>
                <span className="text-sm font-semibold text-ink">{playbook.name}</span>
                <DataText size="xs">{playbook.span}</DataText>
              </Card>
            ))}
          </div>
        </div>
      </Preview>
    </section>
  );
}
