"use client";

import { useEffect, useState, ViewTransition } from "react";
import { usePathname } from "next/navigation";

// **Only a route change starts a view transition** (decision 18, ADR-082 §3;
// PR 601). React starts one for any transition or Suspense reveal that touches
// a `<ViewTransition>`: a tab change (`history.replaceState`), a page under
// `loading.tsx` arriving. Until the browser has captured the old page React
// commits nothing and handles no event, so what was typed meanwhile, ⌘K's
// query and its Enter included, was lost. So the boundary is `"none"` except
// in the render whose path differs from the one last committed.
/** A `<ViewTransition>` that animates only when the route's path changes. */
export function RouteViewTransition({ name, children }: { name?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [committed, setCommitted] = useState(pathname);
  useEffect(() => setCommitted(pathname), [pathname]);
  return (
    <ViewTransition name={name} default={pathname === committed ? "none" : "auto"}>
      {children}
    </ViewTransition>
  );
}
