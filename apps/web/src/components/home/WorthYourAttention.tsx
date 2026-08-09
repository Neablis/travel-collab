import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Task 16 (M9 Preview shell): this is "Worth your attention"'s real prop
// contract per the M10 plan — sample data (preview-fixtures.ts) today, so M9
// only has to swap the data source for a real proactive-suggestion feed and
// wire the CTA's onClick later, never rebuild the component shape. The
// caller always mounts this inside <Preview id="home-worth-attention">
// (Task 3's seam), which shields pointer events and stamps the "Preview ·
// M9" chip, so the ghost CTA below needs no onClick yet.
export type AttentionRow = {
  id: string;
  title: string;
  body: string;
  cta: string;
};

// README §1 "Worth your attention" `Panel`: rows separated by a 1px
// `--color-hairline`, a 10px brand dot, title/body text and a ghost CTA.
export function WorthYourAttention({ items }: { items: AttentionRow[] }) {
  return (
    <Panel title="Worth your attention">
      <div className="flex flex-col">
        {items.map((item, index) => (
          <div
            key={item.id}
            data-testid="attention-row"
            className={cn("flex items-center gap-3.5 py-3", index > 0 && "border-t border-hairline")}
          >
            {/* 10px brand dot (handoff): h-2.5/w-2.5 is the Tailwind scale's
                exact 10px step, so no arbitrary value or inline style is
                needed here. */}
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
            <div className="flex-1">
              <div className="text-sm text-ink">{item.title}</div>
              <div className="mt-0.5 text-sm text-slate">{item.body}</div>
            </div>
            <Button variant="ghost" size="sm">
              {item.cta}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
