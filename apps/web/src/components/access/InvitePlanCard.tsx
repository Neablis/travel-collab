"use client";

import { useMemo } from "react";
import { EyeOff } from "lucide-react";
import type { TripPreview } from "@tc/contracts";
import type { WidgetContext } from "@tc/pages";
import { MacroView } from "@/components/pages/MacroView";
import { FixedPeopleProvider } from "@/components/pages/people";
import { SharedDayMap } from "@/components/playbooks/SharedDayMap";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

// "The plan so far" (M38 canvas, artboard 5): the trip as a pending invite's
// holder may see it, drawn by the notebook's own widgets, read-only, through
// `MacroView` — one fixed set in one order (D5): `trip.strip`, `city.rows`,
// the map, and the total as a `cost` value. The landing and *Have a look first*
// both render this, so there is one pre-accept view of a trip.
//
// **Only the fixed set, and that is not a style choice.** `previewContext`
// carries the total on one synthetic unscheduled stop, which is how `cost{}`
// reads exactly the trip's total and nothing else does; a widget outside the
// set is promised nothing about that context. The map is not a widget at all —
// there is none — so it is `SharedDayMap`, the public days' read-only map, fed
// the preview's stops as they came.

/**
 * The people `previewContext` built, handed to every widget under it — what
 * `trip.people` draws, and the names any person widget would read.
 */
export function PreviewScope({ context, children }: { context: WidgetContext; children: React.ReactNode }) {
  return <FixedPeopleProvider personas={context.personas ?? NO_ONE}>{children}</FixedPeopleProvider>;
}

const NO_ONE = {};

/** One widget of the fixed set, read-only, against the preview's context. */
export function PreviewWidget({ context, name, params = {} }: { context: WidgetContext; name: string; params?: Record<string, unknown> }) {
  // `previewContext` always builds a trip; the type allows none for notebooks.
  if (!context.trip) return null;
  return <MacroView detail={context.trip} context={context.page} globals={context.globals} name={name} params={params} />;
}

/** The plan card: strip, cities, map and the total, and the line saying what joining adds. */
export function InvitePlanCard({ preview, context }: { preview: TripPreview; context: WidgetContext }) {
  // Memoised: the map redraws when its days change identity.
  const days = useMemo(() => preview.days.map((day, dayIndex) => ({ dayIndex, stops: day.stops })), [preview]);
  return (
    <Card raised role="region" aria-label="The plan so far" className="overflow-hidden p-0">
      <Section>
        <Text as="span" className="text-2xs font-semibold uppercase tracking-wider text-slate">
          The plan so far
        </Text>
        <PreviewWidget context={context} name="trip.strip" />
      </Section>
      <Section>
        <PreviewWidget context={context} name="city.rows" />
      </Section>
      <Section>
        <SharedDayMap savedDayId="invite-preview" days={days} scope="all" />
      </Section>
      <Section>
        {/* An unpriced trip has no total, as on the board — and a sentence
            around "nothing priced yet" would read as a total of nothing. */}
        {preview.total.amountMinor !== 0 && (
          <Text className="text-md">
            The trip so far comes to <PreviewWidget context={context} name="cost" />.
          </Text>
        )}
        <Text as="span" className="flex items-start gap-2 text-sm text-slate">
          <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
          What each person is in for, and what each stop costs, show once you join.
        </Text>
      </Section>
    </Card>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2.5 border-b border-hairline px-5 py-3.5 last:border-b-0">{children}</div>;
}
