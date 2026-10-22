"use client";

import { lazy, Suspense, type ReactNode } from "react";
// Named for its first user; it is a plain fallback-on-error boundary.
import { ChartErrorBoundary } from "@/components/ui/chart";

// One of the landing's real feature panels (`LandingFeaturePanels.tsx`), split
// out of the first load: the river's drag-and-drop and `@tc/pages` are most of
// its weight. The server renders the real panel into the page's HTML, so it is
// the chunk's JavaScript that waits; the drawing it is handed is what a
// client-side render shows meanwhile, and stays if the load fails: `Suspense`
// does not catch a rejected `lazy` import, and nothing above the landing but
// `app/global-error.tsx` would.
//
// One import shared by every panel, not one each: under vitest's module mock
// two concurrent imports of the same module can resolve to different modules
// (the real one among them), and in a browser it is one chunk anyway. A failed
// import is forgotten, as the hero's is.
let panels: Promise<typeof import("./LandingFeaturePanels")> | undefined;
/** The one import of the real feature panels every caller shares; a failed one is dropped so the next caller retries. */
export const loadFeaturePanels = () =>
  (panels ??= import("./LandingFeaturePanels").catch((e: unknown) => {
    panels = undefined;
    throw e;
  }));
const PANELS = {
  "find-a-day": lazy(() => loadFeaturePanels().then((m) => ({ default: m.FindADayPanel }))),
  assistant: lazy(() => loadFeaturePanels().then((m) => ({ default: m.AssistantPanel }))),
  crew: lazy(() => loadFeaturePanels().then((m) => ({ default: m.CrewPanel }))),
  "notebook-page": lazy(() => loadFeaturePanels().then((m) => ({ default: m.NotebookPagePanel }))),
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
