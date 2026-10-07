import { Crown } from "lucide-react";
import type { TripMemberProfile } from "@tc/contracts";
import { PersonChip } from "@/components/ui/person-chip";
import { Badge } from "@/components/ui/badge";
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
 * One member of the trip: their chip, name (and "You" on the reader's own
 * row), a role line, and the row's single `⋯` control. `min-h-11` because the
 * row is the phone's touch target, not the chip (SPEC §13.1).
 *
 * `chipTitle` is the reader's own "why am I this colour here" (M38, open
 * question 4): set only on their row, and only when the trip shifted them.
 */
export function PersonRow({
  member,
  name,
  isYou,
  chipTitle,
  menu,
}: {
  member: TripMemberProfile;
  name: string;
  isYou: boolean;
  chipTitle?: string;
  menu: React.ReactNode;
}) {
  return (
    // `data-user-id` lets a test assert identity AND role together; the role
    // words alone are on invite rows too (CodeRabbit, PR #70).
    <li data-testid="person-row" data-user-id={member.userId} className="flex min-h-11 items-center gap-2.5 py-1">
      <PersonChip name={name} avatar={member.avatar} color={member.color} size="sm" title={chipTitle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Text as="span" className="truncate text-sm text-ink">
            {name}
          </Text>
          {isYou ? (
            // `Badge`, so it sits on the 12px floor (KI-2026-10-05-i). Tighter
            // than the default pill: it rides inside a name line.
            <Badge className="shrink-0 px-1.5 py-0 font-medium">You</Badge>
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
