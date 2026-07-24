## Conventions

**No provider wrapper needed.** Every component is self-contained — no ThemeProvider, no required context. Overlay components (`Dialog`, `Sheet`, `Popover`) are controlled: pass `open` + `onOpenChange`, they own no internal open state. `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` must be composed together (Tabs wraps Radix Tabs.Root) — `TabsTrigger`/`TabsContent` render nothing meaningful outside a `Tabs` ancestor. Same for `Table`/`THead`/`TBody`/`TFoot`: compose them together; rows/cells are plain `<tr>`/`<th>`/`<td>` (this sync doesn't ship row/cell wrapper components — style them inline or with the token classes below).

**Styling idiom: Tailwind v4 utility classes over a fixed token set — never an off-system color.** Every component accepts `className` (merged, not replaced, via `clsx`+`tailwind-merge`) and spreads other native props. The token families, exactly as shipped in `styles.css`/`_ds_bundle.css`:

| Kind | Values |
|---|---|
| Color (`bg-*`/`text-*`/`border-*`) | `paper`, `surface`, `moss`, `hairline`, `border-strong`, `border-input`, `slate`, `ink`, `brand`/`brand-hover`/`brand-pressed`/`brand-tint`, `danger`/`danger-tint`/`danger-ink`, `warning`/`warning-tint`/`warning-ink`, `success`/`success-tint`/`success-ink`, `info`/`info-tint`/`info-ink` |
| Text size | `text-xs` `text-sm` `text-base` `text-md` `text-lg` `text-xl` `text-2xl` |
| Radius | `rounded-sm` `rounded-md` `rounded-lg` |
| Shadow | `shadow-raised` (resting elevation, e.g. `Card raised`), `shadow-overlay` (`Dialog`/`Sheet`/`Popover`) |
| Container width | `max-w-content` (default page width), `max-w-measure` (forms/prose) — also `PageContainer`'s `width` prop |
| Font | `font-sans` (body/UI), `font-display` (headings — `Heading` sets this itself), `font-mono` (`DataText` sets this itself — use it for every time/date/duration/currency value, not raw text) |

Prefer a component's own variant props over hand-rolled classes: `Button`/`Badge` take `variant` (`Button`: `primary`/`secondary`/`ghost`/`destructive`; `Badge`: `neutral`/`brand`/`success`/`warning`/`danger`/`info`) and `Button` takes `size` (`sm`/`md`/`icon`). Reach for `className` only for layout glue (flex/gap/width), using the token classes above — never a literal hex/rgb color or an arbitrary text size.

**Where the truth lives.** Read `styles.css` (imports tokens, fonts, then `_ds_bundle.css` — the full compiled component CSS) before styling anything, and each component's own `.prompt.md` for its exact prop shape. Components are grouped: Buttons, Forms, Data Display, Overlays, Navigation, Layout, Feedback, Typography.

**Idiomatic composition** (an itinerary row — real card/heading/text/badge pattern):

```tsx
<Card className="flex items-center justify-between gap-3" style={{ width: 320 }}>
  <div>
    <Heading level={4}>Ferry to Capri</Heading>
    <Text variant="secondary">10:00 AM · Marina Grande</Text>
  </div>
  <div className="flex items-center gap-2">
    <Badge variant="brand">Confirmed</Badge>
    <Button variant="ghost" size="icon" aria-label="Edit">…</Button>
  </div>
</Card>
```
