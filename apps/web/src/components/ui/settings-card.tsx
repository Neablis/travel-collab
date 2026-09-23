import { Label } from "./label";
import { Text } from "./text";
import { cn } from "../../lib/cn";

// SPEC §34.5 — "settings are forms on a measure". A settings field is not a
// full-bleed input: a panel is a `--color-surface` card with a `--color-moss`
// header strip naming the group, and hairline-separated rows in two columns —
// a 170px label column and a control column sized to its content. A field the
// width of the page tells the reader the value could be that long, which is a
// lie in almost every case.
//
// A primitive rather than markup inside `AccountScreen` because §34.5 says the
// same three rules govern whatever Account grows next, and because a raw
// `<label>` is banned outside `components/ui/**` by the lint wall.
//
// **Widths are spacing multiples, not arbitrary values.** `w-42.5` is
// 42.5 x 4px = 170px and `max-w-145` is 580px. The obvious spelling —
// `grid-cols-[170px_minmax(0,1fr)]`, straight off the artboard — is an
// arbitrary Tailwind value and the colour wall rejects it, correctly: the
// scale is the contract.

/** The measure every Account panel sits on (§34.5: 580px). */
export const SETTINGS_MEASURE = "max-w-145";

export function SettingsCard({
  heading,
  children,
  className,
}: {
  /** The group's name. Becomes the moss header strip. */
  heading: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={heading}
      className={cn("overflow-hidden rounded-lg border border-hairline bg-surface", className)}
    >
      <div className="border-b border-hairline bg-moss px-4.5 py-3 text-2xs font-semibold tracking-wider uppercase text-slate">
        {heading}
      </div>
      <div className="flex flex-col px-4.5 pt-1 pb-2">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  /** Present when the row's control is labellable; a read-only row has none. */
  htmlFor?: string;
  /** §34.5: secondary explanation sits UNDER the label, not beside the control. */
  description?: string;
  children: React.ReactNode;
}) {
  return (
    // `last:border-b-0` rather than a `divide-y` on the parent: the artboard
    // draws the separator between rows and not under the final one, and a row
    // owning its own separator survives being reordered or conditionally
    // rendered, which a positional rule does not.
    // **The two columns are a DESKTOP rule and now say so.** §34.5's 170px
    // label column comes off a desktop artboard, and it was applied at every
    // width: on a 411px phone the card's inner measure is ~343px, so the
    // control column got ~157px and `dev+alice@example.com` was CLIPPED —
    // mid-character, against `SettingsCard`'s `overflow-hidden`, with no
    // ellipsis to say anything had been cut. Seen on the preview at 411x852,
    // 2026-09-20; no unit test could have found it, because the clip is a
    // rendered width.
    //
    // Stacked below `md`, the artboard's two columns at and above it. That is
    // the same breakpoint every other phone treatment in M26 uses, and it is
    // 768px, never 640.
    <div
      className="flex flex-col items-start gap-1 border-b border-hairline py-3.5 last:border-b-0 md:flex-row md:items-center md:gap-4"
      data-testid="settings-row"
    >
      {/* A testid because the label COLUMN has no accessible identity of its
          own — it is structure, which is exactly what `docs/guidelines/testing.md`
          says a testid names. Without it the only way to assert the column is a
          parent-node walk, which the lint wall refuses. */}
      <div className="w-full shrink-0 md:w-42.5" data-testid="settings-row-label">
        {htmlFor === undefined ? (
          <Text as="span" className="block text-sm font-semibold text-ink">
            {label}
          </Text>
        ) : (
          <Label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
            {label}
          </Label>
        )}
        {description !== undefined && (
          <Text as="span" className="block pt-0.5 text-xs text-pretty text-slate">
            {description}
          </Text>
        )}
      </div>
      {/* `break-words` so a value with no space in it — an email address, a
          token prefix — wraps rather than running under the card's
          `overflow-hidden`. The two-column layout hid this for as long as the
          column was 170px wide on a 580px measure; stacking is what makes the
          long value reach the edge at all, so the wrap ships with it. */}
      <div className="w-full min-w-0 break-words md:flex-1">{children}</div>
    </div>
  );
}
