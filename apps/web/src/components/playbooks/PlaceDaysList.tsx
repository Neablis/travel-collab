"use client";

import Link from "next/link";
import { PHONE_TOUCH } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import type { DiscoverDay } from "@/lib/playbooks";
import { PLACE_PAGE_SIZE, placePagePath } from "@/lib/playbookUrls";
import type { BreadcrumbCrumb } from "@/lib/jsonLd";
import type { LatticeNav } from "@/lib/latticeNav";
import { cn } from "@/lib/cn";
import { DiscoverCard } from "./DiscoverCard";
import type { PlaybookAskPage } from "@/lib/apiClient";
import { PlaybookAskButton, PlaybookAssistant } from "@/components/assistant/BeyondTripAssistant";

// A client component fed the server's rows: `DiscoverCard` reads the reader's
// clock preference through a hook.
/**
 * A city, country or tag page's body: its heading, how many days, the cards,
 * and the pager. The pager is real links (`?page=N`), because a crawler
 * reaches page two by following one.
 */
export function PlaceDaysList({
  heading,
  summary,
  path,
  crumbs,
  days,
  total,
  page,
  assistant,
  nav,
}: {
  /** The page's title base: one string, for the reason at the heading. */
  heading: string;
  /** The line under it: the page's description, the same sentence as its meta description. */
  summary: string;
  /** The page's own path, page one. */
  path: string;
  /** The page's crumb trail, the same array its BreadcrumbList emits: the last crumb is this page. */
  crumbs: BreadcrumbCrumb[];
  days: DiscoverDay[];
  total: number;
  page: number;
  /** The page an assistant is about (M45 D9): a city's or a tag's. A country page offers none. */
  assistant?: PlaybookAskPage;
  /** The SEO lattice around this page: its parents and its refinements, when the listing computed them. */
  nav?: LatticeNav;
}) {
  const lastPage = Math.max(1, Math.ceil(total / PLACE_PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/playbooks" className={cn("inline-flex w-fit items-center text-sm text-slate hover:underline", PHONE_TOUCH)}>
        ← Discover
      </Link>
      {/* The crumb trail, matching the page's BreadcrumbList crumb for
          crumb: every crumb but the last is a link, the last is this page
          as plain text, so the trail never links a page to itself. */}
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.path} className="flex items-center gap-x-1.5">
                {index > 0 && (
                  <span aria-hidden="true" className="text-slate">
                    ›
                  </span>
                )}
                {last ? (
                  <span aria-current="page">{crumb.name}</span>
                ) : (
                  <Link href={crumb.path} className={cn("inline-flex items-center underline", PHONE_TOUCH)}>
                    {crumb.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div>
        {/* One string, not `{name} playbooks`: two text nodes reach the HTML
            split by a comment, and the heading is what a crawler reads. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={1}>{heading}</Heading>
          {assistant !== undefined && <PlaybookAskButton />}
        </div>
        <Text variant="secondary">{summary}</Text>
      </div>
      {/* The lattice around this page, as links: its parents, then its
          refinements — so a crawler walks up and down without the sitemap. */}
      {nav !== undefined && (nav.parents.length > 0 || nav.children.length > 0) && (
        <nav aria-label="Related playbook pages" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Text variant="secondary">Related pages</Text>
          {[...nav.parents, ...nav.children].map((link) => (
            <Link key={link.href} href={link.href} className={cn("inline-flex items-center underline", PHONE_TOUCH)}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
      <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="place-days">
        {days.map((day) => (
          <DiscoverCard key={day.savedDayId} day={day} origin={{ from: "playbooks" }} />
        ))}
      </ul>
      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-4 text-sm">
          {page > 1 && (
            <Link href={placePagePath(path, page - 1)} rel="prev" className={cn("inline-flex items-center underline", PHONE_TOUCH)}>
              Previous
            </Link>
          )}
          <Text variant="secondary">{`Page ${page} of ${lastPage}`}</Text>
          {page < lastPage && (
            <Link href={placePagePath(path, page + 1)} rel="next" className={cn("inline-flex items-center underline", PHONE_TOUCH)}>
              Next
            </Link>
          )}
        </nav>
      )}
      {assistant !== undefined && <PlaybookAssistant page={assistant} contextLine={heading} />}
    </div>
  );
}
