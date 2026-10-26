import { Fragment, type CSSProperties, type HTMLAttributes } from "react";
import type { AvatarKey, PersonColor } from "@tc/contracts";
import { cn } from "../../lib/cn";
import { PersonChip } from "./person-chip";

export type AvatarStackPerson = {
  /** Keys the face; any value unique within the stack. */
  id: string;
  name: string;
  avatar: AvatarKey | null;
  color: PersonColor | null;
  /** Has the trip open (M46 D7): the chip's dot. */
  online?: boolean;
  /** Said after the name in the face's tip ("online"), where the caller knows it. */
  detail?: string;
};

type StackSize = "xs" | "sm" | "md";

// How far each face tucks under the one before it. The 2px ring is what
// parts them.
const OVERLAP: Record<StackSize, string> = { xs: "-ml-1", sm: "-ml-2", md: "-ml-2" };

/**
 * People as overlapping chips: the first `max` faces, then "+N" for the rest
 * (decision 9). The one stack every surface draws, so the cap, the overlap
 * and the hover agree everywhere.
 *
 * Interactive by default: on a hover the faces spread apart, and the face
 * under the pointer names itself in a tip. The tip is CSS content from
 * `data-avatar-tip` (`globals.css`, M54 avatar stack), not text, so it adds
 * nothing to the words a containing control prints and is named by. The faces
 * stay decorative: the caller says who they are, in a sentence or a label.
 *
 * `interactive={false}` is for a stack under something else that takes the
 * pointer (a board block): no spread, no tip, and each chip keeps its name as
 * a title instead.
 *
 * The spaces between items are for the stack's TEXT, not its look (flex drops
 * a whitespace-only item): without them a control named by what it shows
 * would print "AABBCC+1".
 */
export function AvatarStack({
  people,
  max = 4,
  size = "md",
  interactive = true,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  people: readonly AvatarStackPerson[];
  max?: number;
  size?: StackSize;
  interactive?: boolean;
}) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  // Where each item sits, so a hover can spread them about the middle.
  const at = (index: number) => ({ "--stack-at": index }) as CSSProperties;
  return (
    <span
      data-avatar-stack
      data-interactive={interactive ? "" : undefined}
      className={cn("flex items-center", className)}
      style={{ "--stack-items": shown.length + (more > 0 ? 1 : 0) } as CSSProperties}
      {...props}
    >
      {shown.map((person, index) => (
        <Fragment key={person.id}>
          {index > 0 ? " " : null}
          <span
            data-testid="avatar-face"
            data-avatar-tip={interactive ? [person.name, person.detail].filter(Boolean).join(" · ") : undefined}
            className={cn("relative flex shrink-0", index > 0 && OVERLAP[size])}
            style={at(index)}
          >
            <PersonChip
              name={person.name}
              avatar={person.avatar}
              color={person.color}
              size={size}
              ring
              online={person.online}
              title={interactive ? undefined : person.name}
            />
          </span>
        </Fragment>
      ))}
      {more > 0 ? " " : null}
      {more > 0 ? (
        <span className="relative ml-1.5 text-xs font-semibold text-slate" style={at(shown.length)}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}
