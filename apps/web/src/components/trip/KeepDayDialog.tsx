"use client";

import { useId } from "react";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Preview } from "@/components/ui/preview";

// Handoff README §"Keep this day": clicking the pennant flag opens this
// dialog (name, what's included, visibility). Confirming it is where the
// celebrate() choreography lives in the prototype — spring animation, ring
// burst, sparks, the "Kept" pill reveal, and a "Kept in your Playbooks ·
// link copied" toast — all of which is explicitly M11's job, not this
// task's. This shell only builds the fields; no onSave/submit prop, no
// state change, no toast, no save/share.
//
// The Preview wrap lives INSIDE this component (around the fields +
// footer), not around the whole `<KeepDayDialog>` call site the way
// GhostProposal/AssistantRail are wrapped by their callers. Dialog renders
// its content through a Radix Portal straight to `document.body`, so a
// Preview wrapped around the outside of `<Dialog>` would never actually
// contain the portalled content in the DOM — its pointer-events shield and
// "Preview · M11" chip would sit in a sibling subtree the real dialog markup
// never enters. Wrapping the content here, before it crosses the Portal
// boundary, keeps the shield and the shielded markup in the same rendered
// subtree wherever React ultimately mounts it.
export function KeepDayDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nameId = useId();
  const includedId = useId();
  const visibilityId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keep this day">
      <Preview id="keep-day-dialog" size="container">
        <div className="flex flex-col gap-3">
          <FormField id={nameId} label="Name">
            <Input id={nameId} placeholder="e.g. A day in Nakameguro" />
          </FormField>
          <FormField id={includedId} label="What's included">
            <Input id={includedId} placeholder="Stops, order, gaps and notes — no dates" />
          </FormField>
          <FormField id={visibilityId} label="Visibility">
            <NativeSelect id={visibilityId} defaultValue="private">
              <option value="private">Only me</option>
              <option value="trip">Trip collaborators</option>
              <option value="link">Anyone with the link</option>
            </NativeSelect>
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
          {/* Deliberately no onClick: Confirm is a shell for the M11
              celebrate() sequence (save + toast), which is explicitly out of
              scope here. Cancel is inert too — it's wrapped by the same
              Preview shield, and even the real "close the dialog" behavior
              belongs to the eventual M11 wiring, not this shell. Use the
              Dialog's built-in title-row X (outside this Preview) to close
              it in the interim. */}
          <Button type="button" variant="primary">
            Confirm
          </Button>
        </DialogFooter>
      </Preview>
    </Dialog>
  );
}
