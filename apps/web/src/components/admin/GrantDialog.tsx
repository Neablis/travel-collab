"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Toast } from "@/components/ui/toast";
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
//
// **On the account page since M36 link 3**, not the table row: the page is
// where the operator can see what the account already holds before adding to
// it. The trigger is the header's *Grant a plan* and the success is a toast —
// `GrantForm`'s refresh re-reads the page, and the toast says the change it
// made, since the page's header may not move (a grant of a plan already held
// changes nothing visible).
/** The account page's *Grant a plan* button and the dialog it opens. */
export function GrantDialog({ plans, userId }: { plans: readonly string[]; userId: string }) {
  const [open, setOpen] = useState(false);
  const [granted, setGranted] = useState<string | null>(null);

  return (
    <>
      {/* The accessible name carries the account, so a screen reader (and a
          Playwright `getByRole`) hears which account the write lands on. */}
      <Button
        type="button"
        variant="secondary"
        aria-label={`Grant a plan to ${userId}`}
        onClick={() => setOpen(true)}
      >
        Grant a plan
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Grant a plan">
        <GrantForm
          plans={plans}
          userId={userId}
          onGranted={(planId) => {
            setOpen(false);
            setGranted(`Granted ${planId} — applies on their next request`);
          }}
        />
      </Dialog>
      {granted !== null && <Toast message={granted} onDismiss={() => setGranted(null)} />}
    </>
  );
}
