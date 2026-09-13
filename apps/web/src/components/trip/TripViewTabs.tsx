"use client";

import { TabStrip } from "@/components/ui/tab-strip";
import { VIEWS, useLens, type View } from "./context/LensRouter";

// SPEC §24's four peer tabs. One tab per `View`, in the order the design names
// them — Overview · Plan · Calendar · Map — so the strip and the router cannot
// disagree about what exists, and there is no tab-less state.
//
// **Timeline is gone.** It was the fifth thing this strip could show, and §24
// deletes it rather than hiding it: its read-only day list is a widget on the
// Overview document now, and everything it did that changed the trip was
// always Day columns' job. "Day columns" is **Plan**, which is what the phone
// tab bar has called it all along.
//
// **`usePhoneTwoViews` is gone with it**, and that needs saying because it was
// load-bearing. It rewrote a bare `/trips/<id>` to Timeline on a phone, on SPEC
// §10's grounds — *"Day columns and Calendar exist to show density, which a
// phone cannot show honestly"* — so the phone's editing surface was the
// timeline. With Timeline deleted there is nothing to rewrite TO, and a phone
// now lands on Overview like every other surface and edits in Plan, which
// renders day columns at 390px.
//
// **That is a known, accepted, temporary state**, not an oversight: Mitchell,
// 2026-09-12, *"Lets just build the plan as is for now, and when its ready we
// will figure out where editing moved to."* It is on `TODO.md` with that date
// attached. Do not paper over it with a phone-only fallback view, and do not
// let it quietly become the answer.
const TABS: readonly { value: View; label: string }[] = VIEWS.map((v) => ({ value: v, label: v }));

export function TripViewTabs() {
  const { view, setView } = useLens();
  return <TabStrip value={view} onValueChange={setView} options={TABS} aria-label="Trip view" />;
}
