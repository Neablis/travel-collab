"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { GrantForm } from "./GrantForm";

// **The console's write, opened from the account it applies to** (Mitchell, on
// the #174 preview: *"Grants are spose to be a modal that is triggered off a
// button here"*, pointing at the accounts table).
//
// It was a standalone *Grant* section above the table with a free-text account
// id. Moving it onto the row is not only a layout change — it removes the join
// the operator was making by hand. Reading an id out of one table and typing it
// into a form two sections up is the step where a grant lands on the wrong
// account, and nothing downstream can tell: a well-formed id that belongs to
// somebody else produces a successful grant, not an error.
//
// `Dialog` rather than a bespoke overlay — it carries the height cap and the
// scrolling body that `ui/dialog.tsx` documents at length, including the one
// where a tall centred dialog spills off the TOP of a short viewport and the
// first control becomes unreachable by mouse, keyboard and e2e click alike.
export function GrantDialog({ plans, userId }: { plans: readonly string[]; userId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The accessible name carries the account, because a table of these
          otherwise offers a screen reader (and a Playwright `getByRole`) a
          column of identical "Grant" buttons with no way to say which row. */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={`Grant a plan to ${userId}`}
        onClick={() => setOpen(true)}
      >
        Grant
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Grant a plan">
        <GrantForm plans={plans} userId={userId} onGranted={() => setOpen(false)} />
      </Dialog>
    </>
  );
}
