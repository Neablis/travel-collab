import { cn } from "@/lib/cn";

// The caesura itself — two upright strokes — and the one place its geometry is
// written down.
//
// SPEC §28 replaced the circled dot (◎) that every surface used to render as a
// text glyph: *"It is now **the caesura itself — two upright strokes, ‖** — the
// break mark the product is named after. Sharp, static, no curves, and it fills
// its tile instead of floating a small circle inside a large one."*
//
// **It is drawn, not typed.** The design file carries no `‖` character
// anywhere; every instance is two `background: currentColor` spans
// (`Trip Planner Redesign.dc.html:186, 229, 1001, 3487`). That is not an
// implementation detail to improve on — a text glyph's weight, width and
// baseline are whatever the loaded font says, and "sharp, static, no curves"
// is a claim about geometry that a font cannot be held to. Two spans render
// identically everywhere.
//
// **One component, because the mark drifted once already.** Before this it was
// six hand-written copies of `<span aria-hidden>◎</span>`, three of them with
// their own tile geometry — a `size-8 rounded-xl` in the app header and the
// front door, an inline-styled 22px `rounded-md` in the assistant, a bare glyph
// in the Ask pill. `AskPill`'s own header records what that costs: *"Three call
// sites each writing their own header button is how that happened, and is what
// a shared component is here to stop happening again."* The same argument
// applies to the mark those buttons carry.
//
// **The proportions are derived, not enumerated.** The design draws the mark at
// four sizes and every one of them holds the same ratios — stroke and gap at
// `size / 8`, strokes `size * 0.5625` tall:
//
//   | design site | tile | radius | stroke & gap | stroke height |
//   |---|---|---|---|---|
//   | app header, landing, auth (`:186`, `:3487`) | 32 | 4 | 4 | 18 |
//   | phone header (`:229`) | 28 | 4 | 3.5 | 16 |
//   | assistant panel and sheet (`:1001`) | 24 | 3 | 3 | 13 |
//   | Ask pill (`:257`) | none | — | 2.5 | 11 |
//
// So a caller passes one number and cannot produce a mark with wrong
// proportions. The 24px row rounds its radius to 3px in the design; that is
// within a pixel of 4 and not worth a second rule, so every tile takes the 4px
// the spec states.
const STROKE_RATIO = 1 / 8;
const HEIGHT_RATIO = 0.5625;

export function BrandMark({
  size = 32,
  tile = true,
  tone = "brand",
  pulsing = false,
  className,
}: {
  /**
   * The tile's edge in px, and the unit the strokes are derived from. With
   * `tile={false}` nothing is drawn at this size — it only sets the
   * proportions, which is why the Ask pill passes 20 to get the design's
   * 2.5px × 11px strokes.
   */
  size?: number;
  /** False draws the bare strokes in `currentColor`, for a control that is already a coloured surface (the Ask pill). */
  tile?: boolean;
  tone?: "brand" | "danger";
  /** SPEC §11's save light: the strokes breathe, the tile does not. */
  pulsing?: boolean;
  className?: string;
}) {
  const stroke = size * STROKE_RATIO;
  const strokes = (
    <span
      // `align-items: stretch` with a height on the row is what makes the two
      // strokes full-bleed rather than needing a height of their own — the
      // design's construction, kept.
      className={cn("flex items-stretch", pulsing && "save-light-breathing")}
      // eslint-disable-next-line no-restricted-syntax -- the mark's geometry is derived from `size` (stroke and gap are size/8, height is size*0.5625), so it is computed per instance and has no static token equivalent. This is the one place it is written; every caller passes a number instead of repeating a style.
      style={{ height: `${size * HEIGHT_RATIO}px`, gap: `${stroke}px` }}
    >
      <span
        className="bg-current"
        // eslint-disable-next-line no-restricted-syntax -- derived stroke width, see above.
        style={{ width: `${stroke}px` }}
      />
      <span
        className="bg-current"
        // eslint-disable-next-line no-restricted-syntax -- derived stroke width, see above.
        style={{ width: `${stroke}px` }}
      />
    </span>
  );

  // `data-testid` because the mark is `aria-hidden` decoration and has no text
  // to query: it used to be asserted as `getByText("◎")`, which is precisely
  // the kind of handle that breaks when the thing it names is redrawn rather
  // than removed. A test that means "the panel still carries its mark" gets a
  // handle that survives the next change to its geometry.
  if (!tile)
    return (
      <span aria-hidden data-testid="brand-mark" className={cn("flex shrink-0 items-center", className)}>
        {strokes}
      </span>
    );

  return (
    <span
      aria-hidden
      data-testid="brand-mark"
      className={cn(
        // `rounded-xs` is 4px — added to the token scale for this mark, because
        // §28 states the radius and the scale started at 6px. Ledger squares it
        // to 0 with every other radius; that is the look's job, not this
        // component's.
        "grid shrink-0 place-items-center rounded-xs text-surface",
        tone === "danger" ? "bg-danger" : "bg-brand",
        className,
      )}
      // eslint-disable-next-line no-restricted-syntax -- derived tile geometry, see above. `size-8`-style utilities cannot express an arbitrary caller-chosen edge.
      style={{ height: `${size}px`, width: `${size}px` }}
    >
      {strokes}
    </span>
  );
}
