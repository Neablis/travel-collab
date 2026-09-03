"use client";
import type { BlockPayload } from "@tc/pages";
import { ItineraryDayBlock } from "./blocks/ItineraryDayBlock";
import { ItineraryTripBlock } from "./blocks/ItineraryTripBlock";
import { CostsTableBlock } from "./blocks/CostsTableBlock";

// The one place a block payload becomes a component, and the reason ADR-037
// decision 1's "no switch case" is satisfied by a file that plainly contains a
// switch.
//
// The switch that had to go dispatched on the WIDGET'S NAME, in `MacroView`:
// every new widget was a new `case`, and the `default:` rendered
// `no renderer: <name>` to a user for anyone who forgot. That is the failure
// ADR-037 names — *"if adding the fifteenth widget touches a component, the
// model has failed"*.
//
// This one dispatches on the PRESENTATION. `BlockPayload` is a closed
// discriminated union of shapes, and the design's 21 widgets share about five of
// them, so a widget that renders as an itinerary day adds nothing here. The
// switch grows only when somebody designs a genuinely new way for a block to
// look, which is the moment a new component has to be written anyway.
//
// `never` on the exhaustive branch is what keeps it honest: adding a member to
// `BlockPayload` without a component here fails to compile, so the
// `no renderer:` chip cannot come back as a runtime surprise.
export function BlockView({ block }: { block: BlockPayload }) {
  switch (block.kind) {
    case "itinerary-day":
      return <ItineraryDayBlock payload={block} />;
    case "itinerary-trip":
      return <ItineraryTripBlock payload={block} />;
    case "costs-table":
      return <CostsTableBlock payload={block} />;
  }
}
