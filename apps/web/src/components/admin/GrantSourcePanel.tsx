import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import type { AdminGrantSourceRow } from "@/lib/adminOverview";

// **What the comped accounts cost, by source** — the M20-legal half of the
// design's left-hand panel, and the naming is the whole lesson.
//
// The design titles that panel *"Costs more than it pays"* and labels its lower
// section with a word `admin.console.test.ts` bans outright, beside MRR, ARPU,
// margin and revenue. I built it under those names and the sweep refused the
// file. That is the sweep being right: the banned word means "costs more than
// it takes in", which is a comparison against income, and M20 has no income to
// compare against — so the frame is M21 link 7's even where the data underneath
// it is not. A panel named for a number it cannot compute is how the split
// breaks by vocabulary rather than by code.
//
// What survives is the question M20 *can* answer: these accounts were comped on
// purpose, and this is what they cost. **Counted by source and set aside rather
// than listed**, per the design's own reasoning — mixed into the accounts table
// they would bury the rows that need a decision.
//
// The design's upper section (a count of paying accounts whose cost exceeds
// what they pay, with a button filtering the table to them), the red row
// highlight, and the `Past due` / `Costs more than it pays` filter chips are all
// the same M21 link 7.

function microUsd(value: number): string {
  return `$${(value / 1_000_000).toFixed(4)}`;
}

export function GrantSourcePanel({ sources }: { sources: readonly AdminGrantSourceRow[] }) {
  return (
    <Panel title="What the grants cost">
      <div className="flex flex-col gap-2" data-testid="grant-source-panel">
        <ul className="flex flex-col gap-1">
          {sources.map((row) => (
            <li
              key={row.source}
              className="flex items-baseline justify-between gap-3"
              data-testid={`grant-source-${row.source}`}
            >
              <Text as="span" className="text-xs text-ink">
                {row.source}
              </Text>
              <Text as="span" className="text-xs text-slate">
                {row.accounts} {row.accounts === 1 ? "account" : "accounts"} {"·"}{" "}
                {microUsd(row.microUsd)}
              </Text>
            </li>
          ))}
        </ul>
        <Text as="span" className="text-xs text-slate">
          Comped on purpose, so they&apos;re counted and set aside rather than listed — mixed into
          the table above they&apos;d bury the rows that matter. Trailing 30 days, model tokens
          only. An account holding two grants is counted under both sources, so these are not a
          total.
        </Text>
      </div>
    </Panel>
  );
}
