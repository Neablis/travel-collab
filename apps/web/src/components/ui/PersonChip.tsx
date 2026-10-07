import type { AvatarKey, PersonColor } from "@tc/contracts";
import { cn } from "../../lib/cn";
import { AVATAR_GLYPHS } from "../../lib/avatarGlyphs";
import { initialsFor } from "../../lib/initials";
import { Avatar } from "./avatar";

// Whole class names, not `bg-person-${color}`: Tailwind only emits a utility it
// can read in the source, and the colour wall's token check reads the same way.
const PERSON_BG: Record<PersonColor, string> = {
  moss: "bg-person-moss",
  clay: "bg-person-clay",
  sky: "bg-person-sky",
  plum: "bg-person-plum",
  ochre: "bg-person-ochre",
  rose: "bg-person-rose",
  slate: "bg-person-slate",
  teal: "bg-person-teal",
};

type PersonChipSize = "xs" | "sm" | "md" | "lg";

// The glyph is about half the chip (M38 canvas, artboard 2). Lucide props
// rather than size classes because 15px and 22px are not spacing steps anyone
// else uses. The canvas's CSS draws xs at 2.25; its written rule, "stroke 2,
// 1.75 at lg", is what this follows — 2 is lucide's own default weight.
const GLYPH: Record<PersonChipSize, { size: number; strokeWidth: number }> = {
  xs: { size: 12, strokeWidth: 2 },
  sm: { size: 15, strokeWidth: 2 },
  md: { size: 16, strokeWidth: 2 },
  lg: { size: 22, strokeWidth: 1.75 },
};

export type PersonChipProps = {
  /** What the initials come from when no avatar is chosen. Callers print it beside the chip. */
  name: string;
  avatar: AvatarKey | null;
  /** `null` draws the slate person colour, never the neutral moss of an invite. */
  color: PersonColor | null;
  size?: PersonChipSize;
  /** A 2px surface ring, so overlapping chips in a stack read as separate people. */
  ring?: boolean;
  /** Passed through for the "colour shifted on this trip" tooltip. */
  title?: string;
  className?: string;
};

/**
 * A person's chip: their chosen glyph, or their initials, on their colour.
 * Decorative like `Avatar`, which it draws — the name is always printed
 * beside it. At `xs` the initials drop to one letter.
 */
export function PersonChip({ name, avatar, color, size = "sm", ring, title, className }: PersonChipProps) {
  const Glyph = avatar ? AVATAR_GLYPHS[avatar] : null;
  const initials = initialsFor(name);
  return (
    <Avatar
      name={name}
      size={size}
      tone={null}
      title={title}
      initials={size === "xs" ? initials.slice(0, 1) : initials}
      icon={Glyph ? <Glyph aria-hidden {...GLYPH[size]} /> : undefined}
      className={cn(PERSON_BG[color ?? "slate"], "text-person-on", ring && "ring-2 ring-surface", className)}
    />
  );
}
