import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PhoneTabBar, PhoneTabBarFallback } from "@/components/nav/PhoneTabBar";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";

// The app chrome belongs to authenticated surfaces, not to every route. The
// front door — /welcome, /signin, /signup — draws its own header
// (FrontDoorHeader), so AppHeader moved out of the root layout and into this
// group's layout when M15 split the shell.
//
// M17: account preferences wrap BOTH halves, for the reason SaveLightProvider
// sits above the header in the root layout — the account settings Sheet lives
// in the header's avatar menu and the distances it changes are rendered in the
// page below it, so one provider over both is what lets a switch to Miles
// re-render the map rail without a reload. It reads through the API, not from
// `@/server/*`: this file is UI and the lint wall applies to it (see the
// provider's own note). A client provider here does not make this layout a
// client component — `children` arrives as an already-rendered server tree.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <AppHeader />
      {/* `.phone-tab-bar-inset` (globals.css) keeps the page's last row clear
          of the fixed tab bar below, and is 0px at >=768px where the bar is
          not rendered. The wrapper exists only to own that padding: the bar
          and `children` are siblings, so there is nowhere else to hang a
          reservation that applies to the content and not to the bar itself. */}
      <div className="phone-tab-bar-inset">{children}</div>
      {/* The five tabs span exactly the authenticated routes (SPEC §16:
          Plan / Map / Notebook / Playbooks / Trips), which is exactly what
          this layout wraps — so this is the mount point, and mounting it here
          rather than per-page is also what stops it remounting (and losing
          nothing, since it holds no state) as you move between them. Below
          768px only; it hides itself with `md:hidden`.

          The Suspense boundary is Next's requirement, not a loading state:
          the bar reads `useSearchParams()` (the `?lens=` half of "which tab
          is this"), and an unwrapped `useSearchParams` in a *layout* opts
          every route under it out of static rendering — including the two
          that have no dynamic API of their own (`/playbooks`,
          `/playbooks/board`). The boundary keeps that cost on the bar.

          The fallback is a REAL bar, not `null`. Next satisfies the bailout by
          rendering this fallback on the server and the component on the
          client, so `null` left the bar out of first-paint HTML entirely while
          `.phone-tab-bar-inset` above was already reserving its height — an
          83px gap with no navigation in it, on exactly the surface that has
          nowhere else to navigate from. `PhoneTabBarFallback` renders the same
          five tabs from `usePathname()` alone, which triggers no bailout.
          Copilot caught this on PR #143. */}
      <Suspense fallback={<PhoneTabBarFallback />}>
        <PhoneTabBar />
      </Suspense>
    </PreferencesProvider>
  );
}
