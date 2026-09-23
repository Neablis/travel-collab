import { cn } from "@/lib/cn";
import { starFills } from "./reviewDisplay";

/**
 * Five read-only stars, the last one filled to a fraction (`dc.html:2877`): a
 * hairline star with a warning-coloured copy clipped over it. One image to a
 * screen reader, named by `label`, rather than five glyphs read out one by one.
 */
export function Stars({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cn("inline-flex gap-0.5 leading-none", className)}>
      {starFills(value).map((fill, i) => (
        <span key={i} aria-hidden className="relative inline-block text-hairline">
          ★
          <span
            className="absolute top-0 left-0 overflow-hidden whitespace-nowrap text-warning"
            // eslint-disable-next-line no-restricted-syntax -- computed geometry: the fraction of this star the rating fills (design-system.md's enumerated exception).
            style={{ width: `${fill}%` }}
          >
            ★
          </span>
        </span>
      ))}
    </span>
  );
}
