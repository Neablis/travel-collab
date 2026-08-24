import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

// Task 16 (M11 Preview shell): "Your Playbooks"'s real prop contract per the
// M10 plan — sample data (preview-fixtures.ts) today, so M11 only has to
// swap the data source for the real Playbooks list and wire each card's
// onClick later, never rebuild the component shape. The caller always
// mounts this inside <Preview id="home-playbooks-strip"> (Task 3's seam),
// which shields pointer events and stamps the "Preview · M11" chip, so
// cards below need no onClick yet.
export type PlaybookCard = {
  id: string;
  city: string;
  name: string;
  span: string;
  window: string;
  shape: number[];
};

// Same static-map pattern as Sparkline.tsx's BAR_BG / TripCard.tsx's
// ACCENT_BAR_BG: Tailwind's JIT scanner can't see a template-interpolated
// `bg-${family}` class name, so every accent family needs its own literal
// class pair here.
const PILL_CLASSES: Record<AccentFamily, string> = {
  brand: "bg-brand-tint text-brand-pressed",
  info: "bg-info-tint text-info-ink",
  success: "bg-success-tint text-success-ink",
  warning: "bg-warning-tint text-warning-ink",
  danger: "bg-danger-tint text-danger-ink",
  neutral: "bg-moss text-slate",
};

const STRIP_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

const BAR_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

// README §1 "Your Playbooks": 4-col grid of compact cards — city pill,
// name, 64px shape strip on a tinted background, span + window line.
// Responsive: 4-col → 2-col at 1180px. `.playbooks-grid` (globals.css)
// encodes that exact breakpoint as a real `@media` rule rather than
// Tailwind's default `xl:` (1280px, ~100px off the handoff number) —
// mirroring Task 14's `.assistant-rail-scrim`, which made the same call for
// the same 1180px number.
export function PlaybooksStrip({ playbooks }: { playbooks: PlaybookCard[] }) {
  return (
    <div className="playbooks-grid grid gap-3.5">
      {playbooks.map((pb) => {
        const accent = dayAccents([pb.city])[0]!;
        return (
          <Card key={pb.id} data-testid="playbook-card" className="flex flex-col gap-3 p-4">
            <span
              className={cn(
                "self-start rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
                PILL_CLASSES[accent.solid],
              )}
            >
              {pb.city}
            </span>
            <Heading level={4} className="leading-snug">
              {pb.name}
            </Heading>
            <div className="flex-1" />
            {/* 64px shape strip (handoff): h-16 is the Tailwind scale's
                exact 64px step, so the container needs no arbitrary value.
                Each bar's height is per-playbook data, not a design
                constant, so it's set via inline style like a real chart
                (mirroring Sparkline.tsx's own computed-geometry escape
                hatch for the same reason). */}
            <div className={cn("flex h-16 items-end gap-1 rounded-lg p-2.5", STRIP_BG[accent.solid])}>
              {pb.shape.map((value, index) => (
                <span
                  key={index}
                  data-testid="playbook-bar"
                  aria-hidden
                  className={cn("flex-1 rounded-sm", BAR_BG[accent.solid])}
                  // eslint-disable-next-line no-restricted-syntax -- per-playbook bar height is data, not a design constant, matching Sparkline/TimelineLens/MapLens's computed-geometry pattern
                  style={{ height: `${value}%` }}
                />
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-ink">{pb.span}</span>
              <DataText size="xs">{pb.window}</DataText>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
