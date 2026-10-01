import type { SunPayload } from "@tc/pages";
import type { CityAccents } from "../cityAccents";
import { SunGraphic } from "./SunGraphic";
import { SunTable } from "./SunTable";

// "Sunrise and sunset" (M14 link 11) — one row per located day, drawn as the
// graphic or read as the table (`payload.view`, the widget's "Show as"). Both
// views read the same rows; this file chooses between them.
//
// No footer and no sentence beneath: the sun is arithmetic on a place and a
// date, so there is no source to credit and nothing that can be stale.
//
// **It fits its column**, as the weather block does: neither view gives a row
// a minimum width, so nothing here scrolls sideways.
//
// Spans with table roles, not `<table>`: a widget node is an inline atom and
// renders inside a paragraph (`ItineraryDayBlock` records the hydration error).

/** The sun block: its rows as the graphic or the table. */
export function SunBlock({ payload, accents }: { payload: SunPayload; accents: CityAccents }) {
  return (
    <span className="flex flex-col overflow-hidden rounded-md border border-hairline bg-surface">
      {payload.view === "table" ? <SunTable payload={payload} /> : <SunGraphic payload={payload} accents={accents} />}
    </span>
  );
}
