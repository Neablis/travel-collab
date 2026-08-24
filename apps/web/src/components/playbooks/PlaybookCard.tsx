import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

// Handoff README §3 "Playbooks": one card per saved day that can be dropped
// into any trip. `rawTimes` (24h "HH:MM", one per `preview` row) isn't
// rendered by this card at all — it exists purely to feed
// InsertPlaybookDialog's reflow calc (trip/InsertPlaybookDialog.tsx), the
// same pairing the design handoff prototype's own PLAYBOOKS fixture uses
// (`rawTimes` alongside a display-formatted `preview`).
export type PlaybookCard = {
  id: string;
  city: string;
  name: string;
  span: string;
  origin: string;
  originVariant: "brand" | "info" | "neutral";
  tags: string[];
  shape: number[];
  preview: { time: string; label: string }[];
  rawTimes: string[];
  meta: string;
};

// Same static-map pattern as home/PlaybooksStrip.tsx (Tailwind's JIT scanner
// can't see a template-interpolated `bg-${family}` class name, so every
// accent family needs its own literal class pair).
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

// Handoff §3: `Card raised` — city pill + origin Badge, name, mono span
// line, 72px shape strip, up to 3 preview rows (62px mono time column), tag
// pills, footer with meta and ghost Share + secondary Add to trip (wraps at
// narrow widths). The caller (PlaybooksScreen) is always mounted by
// app/playbooks/page.tsx inside <Preview id="playbooks-route">, so the
// footer buttons below need no onClick yet — same "shape now, wire later"
// contract as home/PlaybooksStrip.tsx's card.
export function PlaybookCard({ playbook }: { playbook: PlaybookCard }) {
  const accent = dayAccents([playbook.city])[0]!;
  return (
    <Card raised data-testid="playbook-detail-card" className="flex flex-col gap-4 rounded-lg p-5">
      <div className="flex items-center justify-between gap-2.5">
        {/* City pill: home/PlaybooksStrip.tsx's own card rounds the
            handoff's 11px pill label to text-xs (12px, the nearest
            Tailwind-scale step) rather than reaching for an arbitrary
            value — same call here, for the same reason. */}
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
            PILL_CLASSES[accent.solid],
          )}
        >
          {playbook.city}
        </span>
        <Badge variant={playbook.originVariant}>{playbook.origin}</Badge>
      </div>

      <div>
        <Heading level={4} className="leading-snug">
          {playbook.name}
        </Heading>
        <DataText size="xs" className="mt-1.5 block">
          {playbook.span}
        </DataText>
      </div>

      {/* 72px shape strip (handoff): no Tailwind scale step lands on 72px
          (h-16 is 64px, h-20 is 80px), so height is an inline-style escape
          hatch — same computed-geometry pattern as Sparkline.tsx and
          home/PlaybooksStrip.tsx's own shape strip. */}
      <div
        className={cn("flex items-end gap-1 rounded-xl p-3", STRIP_BG[accent.solid])}
        // eslint-disable-next-line no-restricted-syntax -- 72px shape strip has no token/Tailwind-scale equivalent (handoff §3)
        style={{ height: "72px" }}
      >
        {playbook.shape.map((value, index) => (
          <span
            key={index}
            aria-hidden
            className={cn("flex-1 rounded-sm", BAR_BG[accent.solid])}
            // eslint-disable-next-line no-restricted-syntax -- per-playbook bar height is data, not a design constant (matches Sparkline/PlaybooksStrip)
            style={{ height: `${value}%` }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {playbook.preview.slice(0, 3).map((row, index) => (
          <div key={index} className="flex gap-2.5 text-sm">
            <DataText
              size="xs"
              className="shrink-0 pt-0.5"
              // eslint-disable-next-line no-restricted-syntax -- 62px mono time column has no token/Tailwind-scale equivalent (handoff §3)
              style={{ width: "62px" }}
            >
              {row.time}
            </DataText>
            <span className="text-ink">{row.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {playbook.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-moss px-2.5 py-1 text-xs text-slate">
            {tag}
          </span>
        ))}
      </div>

      {/* footer with meta and ghost Share + secondary Add to trip; wraps at
          narrow widths (handoff §3) — flex-wrap + justify-between, same
          wrapping contract TripHeader.tsx's action cluster uses. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
        <span className="text-xs text-slate">{playbook.meta}</span>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="sm">
            Share
          </Button>
          <Button type="button" variant="secondary" size="sm">
            Add to trip
          </Button>
        </div>
      </div>
    </Card>
  );
}
