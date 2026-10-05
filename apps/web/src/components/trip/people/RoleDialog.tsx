"use client";

import { useState } from "react";
import type { InviteRole } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { INVITE_ROLES_OFFERED, SUGGESTER_APPROVAL, roleLabel } from "@/lib/tripRole";

// A `Record`, so a role `InviteRole` gains does not compile until it has a
// meaning — the same reason `roleLabel` is one.
const ROLE_MEANING: Record<InviteRole, string> = {
  editor: "Changes the plan directly, as you do.",
  suggester: `Suggests changes ${SUGGESTER_APPROVAL}.`,
  viewer: "Reads the plan and changes nothing.",
};

/**
 * The invitable roles as a segmented control, with one line under it saying
 * what the chosen one may do (spec §4). Shared by the invite dialog and
 * *Change role…*, so the two cannot describe a role differently.
 */
export function RolePicker({ value, onChange }: { value: InviteRole; onChange: (role: InviteRole) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Text as="span" className="text-sm font-medium text-ink">
        Role
      </Text>
      <SegmentedControl
        aria-label="Role"
        fullWidth
        value={value}
        onValueChange={onChange}
        options={INVITE_ROLES_OFFERED.map((role) => ({ value: role, label: roleLabel(role) }))}
      />
      <Text as="span" variant="muted" data-testid="role-meaning">
        {ROLE_MEANING[value]}
      </Text>
    </div>
  );
}

/**
 * *Change role…* for one member (D8). Never offers `owner`: the picker lists
 * `InviteRole`, which cannot hold it.
 */
export function RoleDialog({
  name,
  role,
  busy,
  onOpenChange,
  onChange,
}: {
  name: string;
  role: InviteRole;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (role: InviteRole) => void;
}) {
  const [choice, setChoice] = useState<InviteRole>(role);
  return (
    <Dialog open onOpenChange={onOpenChange} title={`Change ${name}'s role`}>
      <RolePicker value={choice} onChange={setChoice} />
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={busy || choice === role} onClick={() => onChange(choice)}>
          Change role
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
