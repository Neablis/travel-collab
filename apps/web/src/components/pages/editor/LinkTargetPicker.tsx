"use client";
import { useEffect, useState } from "react";
import type { PageListEntry, TripDetail, TripGlobals } from "@tc/contracts";
import { LINK_VIEWS, LinkTarget, formatShortDate, isOverviewPage } from "@tc/pages";
import { fetchPages } from "@/lib/pagesClient";
import { DEDUPE, cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { FieldPicker, type FieldOption } from "./FieldPicker";

// Where an internal link goes, chosen by searching what exists (M30, ADR-056).
// Mitchell, 2026-09-26: *"more of a smart search bar that knows what is
// available and autocompletes, and has simple previews"*.
//
// It is `FieldPicker` — the searchable, grouped combobox the field widget
// already uses — over a different list: the trip's notebooks, its days and its
// tabs, each with a second line from the trip's own data. One combobox in the
// app rather than two that drift apart in keyboard handling.
//
// What it stores is a `LinkTarget` — ids, never a URL — so the option values
// below are an encoding for the combobox only, decoded before anything is
// written.

/** The combobox value for a target. Only this file reads or writes the encoding. */
export function encodeTarget(to: LinkTarget | undefined, detail: TripDetail): string {
  if (to === undefined) return "";
  switch (to.kind) {
    case "notebook":
      return `notebook:${to.pageId}`;
    case "view":
      return `view:${to.view}`;
    case "day": {
      // An index-form ref (from the assistant or an old page) shows as its day.
      const dayId = to.day.kind === "dayId" ? to.day.dayId : detail.days[to.day.index]?.dayId;
      return dayId ? `day:${dayId}` : "";
    }
  }
}

/** The stored target for a combobox value, parsed by the widget's own schema so nothing else can be written. */
export function decodeTarget(value: string): LinkTarget | undefined {
  const [kind, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
  const raw =
    kind === "notebook" ? { kind, pageId: id } : kind === "view" ? { kind, view: id } : kind === "day" ? { kind, day: { kind: "dayId", dayId: id } } : null;
  const parsed = LinkTarget.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

const VIEW_DETAIL: Record<(typeof LINK_VIEWS)[number], string> = {
  Plan: "Every day side by side",
  Calendar: "Each day hour by hour",
  Map: "Every stop with a place, on a map",
};

/** Everything a link can point at, grouped the way the list shows it. */
export function targetOptions(
  notebooks: readonly PageListEntry[] | null,
  detail: TripDetail,
  globals: TripGlobals | null,
): FieldOption[] {
  const notebookOptions: FieldOption[] = (notebooks ?? []).map((page) => ({
    value: `notebook:${page.id}`,
    label: page.title,
    group: "Notebooks",
    detail: isOverviewPage(page.context) ? "The trip's itinerary" : (page.preview?.firstLine ?? undefined),
  }));
  const dayOptions: FieldOption[] = detail.days.map((day, index) => {
    const cities = globals?.days[index]?.cities ?? [];
    const date = formatShortDate(day.date);
    const stops = day.activityIds.length;
    return {
      value: `day:${day.dayId}`,
      label: date === null ? `Day ${index + 1}` : `Day ${index + 1} · ${date}`,
      group: "Days",
      detail: [cities.join(" – "), stops === 0 ? "nothing planned" : `${stops} ${stops === 1 ? "stop" : "stops"}`]
        .filter(Boolean)
        .join(" · "),
    };
  });
  const viewOptions: FieldOption[] = LINK_VIEWS.map((view) => ({
    value: `view:${view}`,
    label: view,
    group: "Trip tabs",
    detail: VIEW_DETAIL[view],
  }));
  return [...notebookOptions, ...dayOptions, ...viewOptions];
}

/** The search-as-you-type combobox an internal link is pointed with; hands `onChange` a `LinkTarget`, never text. */
export function LinkTargetPicker({
  id,
  label,
  value,
  detail,
  globals,
  onChange,
  layout,
}: {
  id: string;
  label?: string;
  value: LinkTarget | undefined;
  detail: TripDetail;
  globals: TripGlobals | null;
  onChange: (next: LinkTarget) => void;
  layout: "inline" | "stacked";
}) {
  // The same read, under the same key, as the Notebook index and the page's
  // link cards make — so opening this usually costs nothing.
  const [notebooks, setNotebooks] = useState<readonly PageListEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void cachedRead(tripKeys.pages(detail.tripId), () => fetchPages(detail.tripId), { dedupeMs: DEDUPE.DOCUMENT }).then((r) => {
      if (live && r.ok) setNotebooks(r.value.pages);
    });
    return () => {
      live = false;
    };
  }, [detail.tripId]);

  const options = targetOptions(notebooks, detail, globals);
  const current = encodeTarget(value, detail);
  // A notebook that has been deleted still shows what it WAS pointed at,
  // rather than an empty box that reads as "never set".
  const withStale =
    current !== "" && !options.some((o) => o.value === current)
      ? [...options, { value: current, label: "A notebook that was deleted" }]
      : options;

  return (
    <FieldPicker
      id={id}
      label={label}
      options={withStale}
      value={current}
      layout={layout}
      placeholder="Search notebooks, days and tabs"
      noMatch="Nothing in this trip matches"
      // Inserting a link opens this — it is the whole next step.
      autoFocus={value === undefined}
      onChange={(next) => {
        const to = decodeTarget(next);
        if (to) onChange(to);
      }}
    />
  );
}
