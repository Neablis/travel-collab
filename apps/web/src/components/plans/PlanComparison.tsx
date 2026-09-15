import { TBody, THead, TH, TD, TR, Table } from "@/components/ui/table";
import type { AccountPlanChoice } from "@/lib/accountPlan";
import { formatPrice } from "@/lib/planCopy";

// **The side-by-side table, and the two rules it exists to not break**
// (SPEC §29).
//
// 1. **The table is not a ranking.** Column order is display metadata, the same
//    rule as §17. A `—` cell is slate, not a red cross, and no cell reads "not
//    included in your plan". **The only comparison on the page is the one the
//    reader makes** — nothing here sorts, scores or nests, and nothing reads a
//    price as an ordering.
// 2. **Each plan enumerates its own contents in full**, never "everything in
//    Plus". That is M20's most load-bearing rule (*a plan is a set, not a
//    rank*) meeting the one surface where it dies quietly: a pricing page is
//    exactly where a ladder gets baked in, because a ladder is what a buyer is
//    looking for. The bullets below are built from each plan's own
//    entitlements and its own ceilings, so a plan that stopped nesting would
//    render correctly without anyone editing this file.

/**
 * One line of who a plan is for — the design's single line per card.
 *
 * **Derived from what the plan grants, not from its name.** The first version
 * of this was a `switch` over plan ids and `planVersions.fourthPlan.test.ts`
 * refused it, correctly: a comparison against a plan id is how the ladder gets
 * baked in, and a pricing page is the surface where that is most tempting and
 * least visible. Reading the entitlements means a plan nobody has written copy
 * for still gets a true line, and the disabled fourth-plan proof — collaborators
 * WITHOUT the full assistant — gets the right one rather than a nonsensical one.
 */
export function whoItIsFor(choice: AccountPlanChoice): string {
  const has = (entitlement: string) => choice.entitlements.includes(entitlement);
  if (has("trip.collaborators")) return "For planning with other people, all editing the same trip.";
  if (has("ai.ask")) return "For planning with the assistant doing the legwork.";
  return "For planning a trip on your own, start to finish.";
}

/**
 * **Four bullets enumerating what this plan grants** (§29), derived from the
 * plan's own record.
 *
 * Every plan gets the same four rows so the cards line up, and each row is
 * answered from THIS plan's entitlements and ceilings — never by reference to
 * another plan's. A `—` is the absence of something, not a cross.
 */
export function planBullets(choice: AccountPlanChoice): string[] {
  const has = (entitlement: string) => choice.entitlements.includes(entitlement);
  return [
    "Trips, days and stops — no limit",
    "Map, costs and saved days",
    has("ai.ask")
      ? `The assistant: ${choice.perUserRequestsPerDay ?? "no limit on"} questions and ${choice.perUserStepsPerDay ?? "no limit on"} steps a day`
      : "No assistant",
    has("trip.collaborators")
      ? "Other people editing your trips, with votes and comments"
      : "Nobody else editing your trips",
  ];
}

/** One row of the comparison: a label and a cell per plan. */
interface Row {
  label: string;
  cell: (choice: AccountPlanChoice) => string;
}

// The seven rows §29 names, in its order.
const ROWS: Row[] = [
  { label: "Trips, days, stops", cell: () => "No limit" },
  { label: "Map, costs, saved days", cell: () => "Yes" },
  {
    label: "Questions a day",
    cell: (choice) =>
      choice.entitlements.includes("ai.ask")
        ? String(choice.perUserRequestsPerDay ?? "No limit")
        : "—",
  },
  {
    label: "Steps a day",
    cell: (choice) =>
      choice.entitlements.includes("ai.ask")
        ? String(choice.perUserStepsPerDay ?? "No limit")
        : "—",
  },
  {
    label: "Other people editing",
    cell: (choice) => (choice.entitlements.includes("trip.collaborators") ? "Yes" : "—"),
  },
  {
    label: "Votes and comments",
    cell: (choice) => (choice.entitlements.includes("trip.collaborators") ? "Yes" : "—"),
  },
  {
    label: "Price",
    cell: (choice) =>
      choice.priceMinor === null
        ? "—"
        : choice.priceMinor === 0
          ? "Free"
          : `${formatPrice(choice.priceMinor, choice.currency)} / month`,
  },
];

export function PlanComparison({ catalogue }: { catalogue: readonly AccountPlanChoice[] }) {
  return (
    // A table is the one thing on this page allowed to be wider than the
    // screen, in its own scroller — three plan columns plus a label column does
    // not fit at phone width and stacking a comparison destroys the comparison.
    //
    // **The width comes from `whitespace-nowrap` on the cells, not from a
    // minimum on the table.** A `min-w-[32rem]` would be an arbitrary value the
    // colour wall refuses, and it would also be a guess: four columns of
    // whatever the plan file publishes is not a number this file can know.
    // Letting the content set the width and scrolling the overflow is both
    // token-clean and correct for a fifth plan.
    <div className="overflow-x-auto" data-testid="plan-comparison">
      <Table className="text-sm">
        <caption className="sr-only">
          What each plan includes. The columns are in display order and that order means nothing.
        </caption>
        <THead>
          <TR>
            <TH scope="col" className="whitespace-nowrap">
              <span className="sr-only">Feature</span>
            </TH>
            {catalogue.map((choice) => (
              <TH
                key={choice.planId}
                scope="col"
                // **The held plan's column is tinted and its values are at
                // weight 600** (§29). Emphasis, not rank.
                className={choice.held ? "whitespace-nowrap bg-moss text-ink" : "whitespace-nowrap"}
              >
                {choice.planId}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {ROWS.map((row) => (
            <TR key={row.label}>
              <TH scope="row" className="whitespace-nowrap font-normal normal-case tracking-normal">
                {row.label}
              </TH>
              {catalogue.map((choice) => {
                const value = row.cell(choice);
                return (
                  <TD
                    key={choice.planId}
                    className={[
                      "whitespace-nowrap",
                      choice.held ? "bg-moss font-semibold text-ink" : "text-ink",
                      // **A `—` is slate, never a red cross.** The design is
                      // explicit, and the reason is the rule above it: a cross
                      // is a judgement and a dash is an absence.
                      value === "—" ? "text-slate" : "",
                    ].join(" ")}
                  >
                    {value}
                  </TD>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
