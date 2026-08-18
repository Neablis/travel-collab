"use client";
import { createContext, useContext, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const LENSES = ["Board", "Map", "Schedule", "Itinerary", "Daily", "Trip"] as const;
export type Lens = (typeof LENSES)[number];
export const SCHEDULE_VIEWS = ["Timeline", "Calendar"] as const;
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number];

type LensCtx = {
  lens: Lens;
  view: ScheduleView;
  setLens: (l: Lens) => void;
  setView: (v: ScheduleView) => void;
  // Sets both in one URL write. TripViewTabs.tsx's Timeline/Calendar tabs
  // need lens="Schedule" AND a specific view together — calling setLens then
  // setView separately in the same handler is a lost update, since each
  // reads the same pre-click `params` closure: the second call's
  // `new URLSearchParams(params)` doesn't see the first call's change (React
  // hasn't re-rendered yet), so the second `router.replace` silently
  // clobbers the first instead of merging with it.
  setLensAndView: (l: Lens, v: ScheduleView) => void;
};
const Ctx = createContext<LensCtx | null>(null);
export const useLens = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLens outside LensRouter");
  return v;
};

export function LensRouter({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const value = useMemo<LensCtx>(() => {
    const lens = (LENSES as readonly string[]).includes(params.get("lens") ?? "")
      ? (params.get("lens") as Lens)
      : "Board";
    const view = (SCHEDULE_VIEWS as readonly string[]).includes(params.get("view") ?? "")
      ? (params.get("view") as ScheduleView)
      : "Timeline";
    const write = (next: URLSearchParams) => router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    return {
      lens,
      view,
      setLens: (l) => {
        const n = new URLSearchParams(params);
        n.set("lens", l);
        write(n);
      }, // one direction: click → URL → derive
      setView: (v) => {
        const n = new URLSearchParams(params);
        n.set("view", v);
        write(n);
      },
      setLensAndView: (l, v) => {
        const n = new URLSearchParams(params);
        n.set("lens", l);
        n.set("view", v);
        write(n);
      },
    };
  }, [params, router, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
