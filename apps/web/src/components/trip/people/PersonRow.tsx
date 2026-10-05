import { Crown } from "lucide-react";
import type { TripMemberProfile } from "@tc/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Text } from "@/components/ui/text";
import { roleLabel } from "@/lib/tripRole";

/**
 * What a member may do, in plain words (spec §4) — never the enum. A member
 * who is not travelling but can shape the plan is "helping plan", the design's
 * own subline; a viewer who is not travelling is only reading, so it says no
 * more than its role.
 */
function roleLine(member: TripMemberProfile): string {
  if (member.role === "owner") return "Owner · created the trip";
  const label = roleLabel(member.role);
  return member.travelling === false && member.role !== "viewer" ? `${label} · helping plan` : label;
}

/**
 * One member of the trip: avatar, name (and "You" on the reader's own row),
 * a role line, and the row's single `⋯` control. `min-h-11` because the row is
 * the phone's touch target, not the avatar (SPEC §13.1).
 */
export function PersonRow({
  member,
  name,
  isYou,
  menu,
}: {
  member: TripMemberProfile;
  name: string;
  isYou: boolean;
  menu: React.ReactNode;
}) {
  return (
    // `data-user-id` lets a test assert identity AND role together; the role
    // words alone are on invite rows too (CodeRabbit, PR #70).
    <li data-testid="person-row" data-user-id={member.userId} className="flex min-h-11 items-center gap-2.5 py-1">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Text as="span" className="truncate text-sm text-ink">
            {name}
          </Text>
          {isYou ? (
            <Text as="span" className="shrink-0 rounded-sm bg-moss px-1.5 text-2xs font-medium text-slate">
              You
            </Text>
          ) : null}
        </span>
        <Text as="span" variant="muted" className="flex items-center gap-1">
          {roleLine(member)}
          {member.role === "owner" ? (
            <Crown data-testid="owner-crown" className="size-3 text-brand" aria-hidden />
          ) : null}
        </Text>
      </div>
      {menu}
    </li>
  );
}
