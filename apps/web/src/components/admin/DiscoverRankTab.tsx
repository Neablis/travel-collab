import Link from "next/link";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { DiscoverRankRow } from "@/lib/adminDiscoverRank";
import { shortDayTime } from "./aiFormat";

const HEAD = "whitespace-nowrap border-b border-border-strong bg-moss font-mono";

const fixed = (n: number) => n.toFixed(2);

/**
 * **The Discover rank tab** (M61 decision 8, ADR-090): the top days by score,
 * each component of the score, when it was computed, and the constants in
 * force, so a tuning change is judged on production data. Operators only — the
 * page 404s everyone else before the rows are read.
 *
 * The constants arrive as a prop, read from `RANK_CONSTANTS` by the page rather
 * than copied here, so this list cannot drift from what the cron computed with.
 */
export function DiscoverRankTab({
  rows,
  constants,
}: {
  rows: DiscoverRankRow[];
  constants: Readonly<Record<string, number>>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Constants in force">
        <ul aria-label="Constants in force" className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(constants).map(([name, value]) => (
            <li key={name} className="flex items-baseline justify-between gap-3">
              <Text as="span" variant="secondary" className="text-sm">
                {name}
              </Text>
              <DataText>{value}</DataText>
            </li>
          ))}
        </ul>
      </Panel>
      {rows.length === 0 ? (
        <EmptyState
          title="No ranks yet"
          body="The rank cron has not run, so no day has a score. Discover falls back to its older order until it does."
        />
      ) : (
        <Panel title={`Top ${rows.length} ranked days`}>
          <div className="overflow-x-auto">
            <Table aria-label="Top ranked days">
              <THead>
                <TR>
                  <TH scope="col" className={HEAD}>Day</TH>
                  <TH scope="col" className={HEAD}>Score</TH>
                  <TH scope="col" className={HEAD}>Adds</TH>
                  <TH scope="col" className={HEAD}>Comments</TH>
                  <TH scope="col" className={HEAD}>Quality</TH>
                  <TH scope="col" className={HEAD}>New-day lift</TH>
                  <TH scope="col" className={HEAD}>Computed</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.savedDayId}>
                    <TD className="font-semibold text-ink">
                      <Link href={`/playbooks/day/${row.savedDayId}`} className="text-ink underline">
                        {row.title}
                      </Link>
                    </TD>
                    <TD>
                      <DataText>{fixed(row.score)}</DataText>
                    </TD>
                    <TD>
                      <DataText>{fixed(row.addsRecent)}</DataText>
                    </TD>
                    <TD>
                      <DataText>{fixed(row.commentsRecent)}</DataText>
                    </TD>
                    <TD>
                      <DataText>{fixed(row.quality)}</DataText>
                    </TD>
                    <TD>
                      <DataText>{fixed(row.newDayLift)}</DataText>
                    </TD>
                    <TD>
                      <DataText as="time" dateTime={row.computedAt}>
                        {shortDayTime(row.computedAt)}
                      </DataText>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}
