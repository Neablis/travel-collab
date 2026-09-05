"use client";
import { useState } from "react";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { getMacro, getPreset, insertPreset } from "@tc/pages";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Popover } from "@/components/ui/popover";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { WidgetPicker } from "@/components/pages/WidgetPicker";
import {
  WidgetBindControls,
  bindSummary,
  presetBindableInputs,
  presetTarget,
} from "@/components/pages/editor/widgetBind";

// The insert surface — ADR-037 decision 4. It has two containers and one model,
// which is the whole point of SPEC §19: *"the same registry, same order, same
// copy as desktop"*.
//
// **Desktop is a popover, not a rail.** It began as an `<aside>` flex sibling of
// the editor, which shrank the prose column the moment it opened. Mitchell,
// walking the preview (2026-09-04): *"The widgets should be more of a popover
// side bar so they dont interrupt the document flow when open, then go to a
// different ui when done editing."* Radix's Popover portals and positions
// absolutely, so opening it cannot reflow a single line of the document — that
// property is the requirement, not the styling.
//
// **Phone is one bottom sheet with two steps inside it** (§19): browse, then
// point it at. Not a sheet over a sheet — project rule 3, and §19 restates it as
// "one sheet deep, ever".
//
// Neither container decides what a valid node is. `insertWidget` does, and it is
// the one path (decision 4 — "there is no way to put a widget into a document
// that skips validation").

export type MacroNode = { type: "macro"; attrs: { name: string; params: Record<string, unknown> } };

// The picker only ever offers preset ids the catalogue gave it, so a refusal
// here can only mean the resolved params do not parse — which
// `presets.test.ts` asserts never happens for a preset's own params. Nothing is
// inserted rather than something invalid.
//
// `insertPreset` resolves `(primitive, params)` and then goes through
// `insertWidget`, so a preset is a shortcut for choosing arguments and not a
// second door into a document (ADR-037 decision 4).
function build(presetId: string, extra: Record<string, unknown>): MacroNode | null {
  const result = insertPreset(presetId, extra);
  return result.ok ? result.node : null;
}

export function WidgetInsert({
  detail,
  globals,
  onInsert,
}: {
  detail: TripDetail;
  globals: TripGlobals | null;
  onInsert: (node: MacroNode) => void;
}) {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  // The phone's second step. `null` is the browse step; a name means "point this
  // one at something before it lands". Desktop has no such state: a widget
  // inserted at the caret is already visible on the page with its chrome row
  // under it, so a bind step there would be the same choice offered twice
  // (project rule 4).
  const [pending, setPending] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});

  const close = () => {
    setOpen(false);
    setPending(null);
    setParams({});
  };

  const insert = (presetId: string, withParams: Record<string, unknown>) => {
    const node = build(presetId, withParams);
    if (node) onInsert(node);
    close();
  };

  const trigger = (
    <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
      Insert a widget
    </Button>
  );

  if (!isPhone) {
    return (
      <Popover
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        trigger={trigger}
        align="end"
        collisionPadding={12}
        // Taller than the default popover because this one is a list that
        // grows with the registry; `max-h-` + scroll rather than a fixed height
        // so a filter narrowing it to two rows does not leave a tall empty box.
        contentClassName="max-h-96 overflow-y-auto"
      >
        <Heading level={4} className="mb-1">Widgets</Heading>
        <p className="mb-2 text-xs text-slate">
          Click one to drop it where your cursor is, or drag it onto the page.
        </p>
        <WidgetPicker
          draggable
          autoFocus
          // Closes on pick, and says so rather than leaving it to Radix. The
          // insert puts focus back in the document (that is what "at the
          // cursor" means — the author carries on typing), which trips
          // Radix's own focus-outside dismissal. Relying on that would make
          // the behaviour a side effect of where focus went, so a later change
          // to the insert path would silently change whether the popover
          // closes. Closing here makes it the decision it already was.
          onPick={(presetId) => {
            const node = build(presetId, {});
            if (node) onInsert(node);
            close();
          }}
        />
      </Popover>
    );
  }

  // The phone's step 2 works on the preset's PRIMITIVE — its controls, its
  // preview — while the id it inserts stays the preset's.
  const pendingPreset = pending === null ? null : getPreset(pending);
  const pendingTarget = pending === null ? null : presetTarget(pending);
  const pendingDef = pendingTarget === null ? null : getMacro(pendingTarget.widget);

  return (
    <>
      {trigger}
      <Sheet
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        size="bottom"
        title={pendingPreset ? pendingPreset.title : "Insert a widget"}
      >
        {pending === null || pendingDef === null || pendingDef === undefined || pendingTarget === null ? (
          <WidgetPicker
            onPick={(presetId) => {
              // A preset whose name already answers every dimension is finished
              // the moment it lands, so §19 has it skip step 2 entirely rather
              // than showing an empty "point it at" with nothing in it.
              if (presetBindableInputs(presetId).length === 0) {
                insert(presetId, {});
                return;
              }
              setPending(presetId);
              setParams({});
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Back to browse. §19: "Back from step 2 is ‹ All, back from step 1
                is Cancel — the sheet is never a dead end." Cancel is the
                Sheet's own close button. */}
            <Button
              variant="ghost"
              className="min-h-11 self-start px-0"
              onClick={() => {
                setPending(null);
                setParams({});
              }}
            >
              ‹ All
            </Button>
            <Text variant="secondary">{pendingPreset?.description ?? pendingDef.description}</Text>
            <WidgetBindControls
              name={pendingTarget.widget}
              params={params}
              detail={detail}
              globals={globals}
              onChange={setParams}
              layout="stacked"
              idPrefix="widget-insert"
              // Only the dimensions the preset has NOT already answered. "A
              // line for every booking" does not offer to stop being about
              // bookings on the way in.
              inputs={presetBindableInputs(pending)}
            />
            <div>
              <Text variant="muted">Reads as</Text>
              {/* The FIXED sample (ADR-037 decision 5), never the live value.
                  §19 restates it for this screen: "the insert sheet's preview
                  line never shows live values — otherwise it reads as a result
                  rather than a description." */}
              <Text variant="secondary">{pendingPreset?.preview ?? pendingDef.preview}</Text>
            </div>
            {/* What it will be pointed at, in the words the button on the page
                will use afterwards — so "Insert it" is not a leap of faith.
                Unset is a real, legal outcome here (decision 6 never defaults a
                day), so this never blocks the insert; it only says so. */}
            <Text variant="muted">
              Showing{" "}
              {bindSummary(
                pendingTarget.widget,
                { ...pendingTarget.params, ...params },
                detail,
                globals,
                presetBindableInputs(pending),
              )}
            </Text>
            <Button
              variant="primary"
              className="min-h-12 w-full"
              onClick={() => insert(pending, params)}
            >
              Insert it
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
