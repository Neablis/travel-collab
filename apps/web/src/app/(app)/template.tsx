// **The route cross-fade where the browser has no View Transitions API**
// (decision 18, ADR-082 §3). A template remounts when the segment under it
// changes, so its page fades in once per route; `globals.css` runs that fade
// only under `@supports not (view-transition-name: none)`, and never under
// reduced motion. Here and in `(front)`, not at `app/`: a root template is
// keyed on the route group, so it would remount only between the two.
/** The app's pages, faded in on each route where view transitions are missing. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div data-route-enter>{children}</div>;
}
