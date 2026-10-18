"use client";

import { lazy, Suspense, type ReactNode } from "react";
// Named for its first user; it is a plain fallback-on-error boundary.
import { ChartErrorBoundary } from "@/components/ui/chart";

// One of the landing's real feature panels (`LandingFeaturePanels.tsx`), split
// out of the first load as the hero's are (`LandingHeroArt.tsx` gives the
// numbers). The server renders the real panel into the page's HTML, so it is
// the chunk's JavaScript that waits; the drawing it is handed is what a
// client-side render shows meanwhile, and stays if the load fails: `Suspense`
// does not catch a rejected `lazy` import, and nothing above the landing but
// `app/global-error.tsx` would.
const loadPanels = () => import("./LandingFeaturePanels");
const PANELS = {
  together: lazy(() => loadPanels().then((m) => ({ default: m.TogetherPanel }))),
  playbook: lazy(() => loadPanels().then((m) => ({ default: m.PlaybookPanel }))),
  "playbook-compact": lazy(() => loadPanels().then((m) => ({ default: m.CompactPlaybookPanel }))),
  notebook: lazy(() => loadPanels().then((m) => ({ default: m.MemoryPanel }))),
};

/** The real `panel`, with `children` — its drawing — while it loads or if it cannot. */
export function LandingFeaturePanel({ panel, children }: { panel: keyof typeof PANELS; children: ReactNode }) {
  const Panel = PANELS[panel];
  return (
    <ChartErrorBoundary fallback={children}>
      <Suspense fallback={children}>
        <Panel />
      </Suspense>
    </ChartErrorBoundary>
  );
}
