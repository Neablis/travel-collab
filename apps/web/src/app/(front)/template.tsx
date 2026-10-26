// The front door's half of the route cross-fade's fallback: see
// `(app)/template.tsx` for why it is a template, and why one per group.
/** The front door's pages, faded in on each route where view transitions are missing. */
export default function FrontTemplate({ children }: { children: React.ReactNode }) {
  return <div data-route-enter>{children}</div>;
}
