import type { ReviewSummary } from "@tc/contracts";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { histogramBars, ratingLabel, reviewCountLabel, starsPhrase } from "./reviewDisplay";
import { Stars } from "./Stars";

/**
 * The top of the shared day's sticky rail (§15, `dc.html:2872`): the average,
 * five fractional stars and the count, then the 5→1 histogram — or, with no
 * reviews, the one line that says so. Renders the summary it is given; the
 * live recompute is `useDayReviews`'.
 *
 * `average` is null exactly when nothing is rated (the contract's rule), and
 * that is the only branch: a 0.0 average would be a claim nobody made.
 */
export function ReviewRail({ summary }: { summary: ReviewSummary }) {
  if (summary.average === null) {
    return (
      <Text variant="secondary" className="text-pretty" data-testid="review-rail">
        Unrated so far — nobody has run it and come back.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="review-rail">
      <div className="flex items-end gap-2.5">
        {/* 30px, the display scale's largest fixed step. The artboard draws
            38px; `text-4xl` starts at 38 but grows to 58 on a wide screen,
            which in a 288px rail is a number wider than its own label. */}
        <span className="font-display text-2xl leading-none font-semibold text-ink" data-testid="rating-average">
          {ratingLabel(summary.average)}
        </span>
        <div className="flex flex-col gap-1 pb-0.5">
          <Stars value={summary.average} label={`${ratingLabel(summary.average)} out of 5 stars`} className="text-sm" />
          <Text as="span" variant="muted" data-testid="review-count">
            {reviewCountLabel(summary.count)}
          </Text>
        </div>
      </div>
      <ul className="flex flex-col gap-1" aria-label="How people rated it" data-testid="rating-histogram">
        {histogramBars(summary.histogram).map((bar) => (
          <li
            key={bar.stars}
            className="flex items-center gap-2"
            aria-label={`${starsPhrase(bar.stars)}: ${bar.count}`}
          >
            <DataText size="xs" className="w-4 text-2xs" aria-hidden>
              {bar.stars}
            </DataText>
            <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-moss">
              <span
                className="block h-full rounded-full bg-warning"
                // eslint-disable-next-line no-restricted-syntax -- computed geometry: the bar's share of the largest bucket.
                style={{ width: `${bar.widthPct}%` }}
              />
            </span>
            <DataText size="xs" className="w-6 text-right text-2xs" aria-hidden>
              {bar.count}
            </DataText>
          </li>
        ))}
      </ul>
    </div>
  );
}
