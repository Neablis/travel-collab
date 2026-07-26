"use client";
import type { TripDetail, PageContext } from "@tc/contracts";
import { resolveMacro, getMacro } from "@tc/pages";
import { EmptyChip } from "./EmptyChip";
import { ItineraryDayBlock } from "./blocks/ItineraryDayBlock";
import { ItineraryTripBlock } from "./blocks/ItineraryTripBlock";
import { CostsTableBlock } from "./blocks/CostsTableBlock";

// Dispatches a resolved macro outcome to its renderer. This is the C-era swap
// seam (design spec §3): block components consume resolver *payloads*
// (structured data), never markup, so a future live-lens upgrade only
// touches the renderer files under this directory.
export function MacroView({ detail, context, name, params, onBindDay }: {
  detail: TripDetail; context: PageContext; name: string; params: Record<string, unknown>;
  onBindDay?: () => void;
}) {
  const def = getMacro(name);
  const outcome = resolveMacro(detail, context, name, params);
  if (outcome.status === "unknown") return <EmptyChip tone="error" label={`unknown macro: ${name}`} />;
  if (outcome.status === "bad-params") return <EmptyChip tone="error" label={`bad params: ${name}`} />;
  if (outcome.status === "unbound") return <EmptyChip tone="action" label="select a day" onClick={onBindDay} />;
  if (outcome.status === "empty") return <EmptyChip tone="muted" label={def?.emptyText ?? "—"} />;
  // ok:
  if (def?.kind === "inline") return <span className="text-ink">{outcome.value as string}</span>;
  switch (name) {
    case "itinerary.day": return <ItineraryDayBlock payload={outcome.value as never} />;
    case "itinerary.trip": return <ItineraryTripBlock payload={outcome.value as never} />;
    case "costs.table": return <CostsTableBlock payload={outcome.value as never} />;
    default: return <EmptyChip tone="error" label={`no renderer: ${name}`} />;
  }
}
