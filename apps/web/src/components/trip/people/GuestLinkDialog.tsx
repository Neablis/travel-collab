"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";

/**
 * *Link to a member…* for one guest (guests spec P1): the owner's picker of
 * which trip member claims the guest record. A guest already claimed by
 * someone else is refused server-side — the owner unlinks first — so the
 * dialog only ever opens on an unclaimed guest.
 */
export function GuestLinkDialog({
  guestName,
  members,
  busy,
  onOpenChange,
  onLink,
}: {
  guestName: string;
  /** The members the record may be claimed for, in the trip's join order. */
  members: readonly { userId: string; name: string }[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (userId: string) => void;
}) {
  const [choice, setChoice] = useState("");
  return (
    <Dialog open onOpenChange={onOpenChange} title={`Link ${guestName} to a member`}>
      <div className="flex flex-col gap-1.5">
        <NativeSelect aria-label="Member" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a member</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
        {/* The consequence that matters (part 2's dedup): a linked guest
            counts as that member for per-person costs, not as one more head. */}
        <Text as="span" variant="muted">
          A linked guest counts as that member wherever heads are counted.
        </Text>
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={busy || choice === ""} onClick={() => onLink(choice)}>
          Link
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
