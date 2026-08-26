"use client";

import { Button } from "@/components/ui/button";
import { toClockRange } from "@/lib/time";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";

// Task 15 (M9 Preview shell): the in-timeline ghost proposal's real prop
// contract per the M10 plan — sample data + a no-op handler pair today (fed
// by preview-fixtures.ts), so M9 only has to swap the data source and wire
// real handlers later, never rebuild the component shape. The caller always
// mounts this inside <Preview id="timeline-ghost"> (Task 3's seam), which
// shields pointer events and stamps the "Preview · M9" chip, so neither
// callback below actually fires yet.
export type Proposal = {
  id: string;
  title: string;
  why: string;
  start: string;
  end: string;
};

// Handoff README §"Assistant proposals (ghosts)": dashed 1px --color-brand
// card on --color-brand-tint, "Assistant proposal" outline chip, primary
// "Keep" + ghost "Discard". Badge (components/ui/badge.tsx) has no
// "outline" variant — every variant there is a solid `bg-*-tint` fill, which
// is the opposite of what an "outline chip" calls for — so the chip below is
// a plain bordered span that mirrors Badge's own class shape (rounded-full
// px-2.5 py-0.5 text-xs font-semibold) but with a `border-brand` outline
// instead of a tint fill, matching TimelineLens's established pattern of a
// hand-rolled span where no existing component variant fits.
export function GhostProposal({
  proposal,
  onKeep,
  onDiscard,
}: {
  proposal: Proposal;
  onKeep: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  return (
    <div
      data-testid={`ghost-proposal-${proposal.id}`}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-brand bg-brand-tint p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-brand bg-surface px-2.5 py-0.5 text-xs font-semibold text-brand-pressed">
          Assistant proposal
        </span>
        <DataText size="xs" className="text-brand-pressed">
          {toClockRange(proposal.start, proposal.end)}
        </DataText>
      </div>
      <Heading level={4}>{proposal.title}</Heading>
      <Text variant="secondary">{proposal.why}</Text>
      <div className="flex gap-1.5 pt-0.5">
        <Button variant="primary" size="sm" onClick={() => onKeep(proposal.id)}>
          Keep
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDiscard(proposal.id)}>
          Discard
        </Button>
      </div>
    </div>
  );
}
