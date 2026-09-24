import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";
import type { AdminPriceCheckRow, AdminPriceConsistencyView } from "@/lib/adminOverview";

// **Does Stripe charge what the plan file says** — M21 link 2's gate box, read
// by the person it exists for (KI-2026-09-16-c).
//
// The till checks the one version being bought; this is the sweep across every
// published version, including the ones nobody has bought lately. It sat
// written and uncalled until this panel, which meant a disagreement would have
// been reported by nothing.
//
// **Amounts are printed in the currency's minor units with the currency code**,
// the same words `PriceMismatchError` uses. A mismatch can be a CURRENCY
// mismatch, and a `$` formatter would print a euro Price as dollars on the one
// row that most needs to be read exactly.

function stated(value: { minor: number | null; currency: string } | null): string {
  if (value === null) return "—";
  return `${value.minor ?? "nothing"} ${value.currency}`;
}

const VERDICT_TEXT: Record<AdminPriceCheckRow["verdict"], string> = {
  ok: "matches",
  missing: "no Price yet",
  mismatch: "MISMATCH",
  unpriced: "not sold",
};

/**
 * The console panel for the price sweep: one row per published version with the
 * plan file's price, Stripe's, and a verdict — or a sentence saying why nothing
 * was checked.
 */
export function PriceCheckPanel({ report }: { report: AdminPriceConsistencyView }) {
  return (
    <Panel title="Stripe charges what the plan says">
      <div className="flex flex-col gap-2" data-testid="price-check-panel">
        {report.status === "unconfigured" ? (
          <Text as="span" className="text-xs text-slate" data-testid="price-check-unconfigured">
            Billing is not configured on this deployment, so there is nothing to compare against.
          </Text>
        ) : report.status === "unavailable" ? (
          <Text as="span" className="text-xs text-ink" data-testid="price-check-unavailable">
            Not checked — Stripe did not answer: {report.reason}
          </Text>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.rows.map((row) => (
              <li
                key={row.ref}
                className="flex flex-wrap items-baseline justify-between gap-3"
                data-testid={`price-check-${row.ref}`}
                data-verdict={row.verdict}
              >
                <Text as="span" className="text-xs text-ink">
                  {row.ref}
                  <span className="ml-2 text-slate">
                    plan {stated(row.committed)} {"·"} Stripe {stated(row.stripe)}
                  </span>
                </Text>
                <Text
                  as="span"
                  className={`text-xs ${row.verdict === "mismatch" ? "font-semibold text-ink" : "text-slate"}`}
                >
                  {VERDICT_TEXT[row.verdict]}
                </Text>
              </li>
            ))}
          </ul>
        )}
        <Text as="span" className="text-xs text-slate">
          Read-only. A version nobody has bought yet has no Price, and that is ordinary; a mismatch
          means publish a new version rather than edit this one.
        </Text>
      </div>
    </Panel>
  );
}
