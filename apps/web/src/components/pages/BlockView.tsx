"use client";
import type { BlockPayload } from "@tc/pages";
import type { CityAccents } from "./cityAccents";
import { ItineraryDayBlock } from "./blocks/ItineraryDayBlock";
import { ItineraryTripBlock } from "./blocks/ItineraryTripBlock";
import { CostsTableBlock } from "./blocks/CostsTableBlock";
import { CityDetailBlock } from "./blocks/CityDetailBlock";

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
// The `never` assignment below is what keeps it honest: adding a member to
// `BlockPayload` without a component here fails to compile, so the
// `no renderer:` chip cannot come back as a runtime surprise.
//
// **It was not there, and this comment claimed it was** — caught by CodeRabbit
// on PR 134. A bare exhaustive switch is not enough: `strict` does NOT imply
// `noImplicitReturns`, and this repo sets only `strict` in `tsconfig.base.json`,
// so a fourth `BlockPayload` member compiled clean and made this function
// return `undefined` — React renders nothing, silently, which is the exact
// failure the name switch used to make loud with a `no renderer:` chip.
// Measured before fixing: a probe member added to the union typechecked with no
// error. That is `.coderabbit.yaml`'s own named defect class (KI-1, KI-14) — a
// comment asserting an invariant nothing enforces.
// `accents` rides alongside the payload rather than inside it, and that is the
// seam working rather than leaking: `resolve` answers what a day means and the
// renderer answers what it looks like (ADR-037 decision 1). A colour in
// `packages/pages` would be a resolver deciding presentation; a city NAME in
// the payload and a family derived here is the split the ADR asks for.
export function BlockView({ block, accents }: { block: BlockPayload; accents: CityAccents }) {
  switch (block.kind) {
    case "itinerary-day":
      return <ItineraryDayBlock payload={block} />;
    case "itinerary-trip":
      return <ItineraryTripBlock payload={block} accents={accents} />;
    case "costs-table":
      return <CostsTableBlock payload={block} />;
    case "city-detail":
      return <CityDetailBlock payload={block} accents={accents} />;
    default: {
      // Not dead code and not defensive: this line is the enforcement. If
      // `block` is ever not `never` here, the assignment fails to compile and
      // names the member nobody wrote a component for.
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}
