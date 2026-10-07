"use client";

import { Check } from "lucide-react";
import { AvatarKey, PersonColor } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { PERSON_BG } from "@/components/ui/person-chip";
import { useRovingRadio } from "@/components/ui/use-roving-radio";
import { AVATAR_GLYPHS } from "@/lib/avatarGlyphs";
import { cn } from "@/lib/cn";

// `null` is a real option here, drawn last as "Initials" (M38 canvas,
// artboard 1). `IconRadioGroup` cannot carry it — its options are icons and
// its empty state has no radio — so this is that group's shape with one more
// button: the same roving tab stop and arrows, and the same "click the chosen
// one again to clear it". With nothing chosen the tab stop lands on Initials,
// which is what is chosen.
const AVATAR_OPTIONS: readonly (AvatarKey | null)[] = [...AvatarKey.options, null];

/** "palm" -> "Palm": what a screen reader hears and the tooltip shows for a key. */
function labelFor(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The twelve glyphs plus Initials, as one radio group. 44px on a phone and
 * 40px above it, the canvas's sizes, with the glyph at 18px.
 */
export function AvatarPicker({
  value,
  initials,
  disabled,
  onValueChange,
}: {
  value: AvatarKey | null;
  /** Drawn on the Initials option, so it shows what choosing none looks like. */
  initials: string;
  disabled?: boolean;
  onValueChange: (next: AvatarKey | null) => void;
}) {
  const radioProps = useRovingRadio(AVATAR_OPTIONS, value, onValueChange);
  return (
    <div role="radiogroup" aria-label="Avatar" className="flex flex-wrap gap-2 md:gap-1.5">
      {AVATAR_OPTIONS.map((option, i) => {
        const on = value === option;
        const Glyph = option === null ? null : AVATAR_GLYPHS[option];
        const label = option === null ? "Initials" : labelFor(option);
        return (
          <Button
            key={option ?? "initials"}
            {...radioProps(i)}
            variant={on ? "primary" : "secondary"}
            size="icon"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={option === null ? "No avatar: show initials" : label}
            disabled={disabled}
            onClick={() => onValueChange(on ? null : option)}
            className={cn("size-11 md:size-10", option === null && "text-xs font-semibold", option === null && !on && "text-slate")}
          >
            {Glyph ? <Glyph className="size-4.5" aria-hidden /> : <span aria-hidden>{initials}</span>}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The eight person colours as round swatches, a check on the chosen one.
 *
 * No "none" (canvas, artboard 1): someone who never picks is given a colour
 * per trip by the server. So `null` checks nothing, and picking the chosen
 * swatch again does nothing rather than clearing it.
 */
export function ColorPicker({
  value,
  disabled,
  onValueChange,
}: {
  value: PersonColor | null;
  disabled?: boolean;
  onValueChange: (next: PersonColor) => void;
}) {
  const radioProps = useRovingRadio(PersonColor.options, value, onValueChange);
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
      {PersonColor.options.map((option, i) => {
        const on = value === option;
        return (
          <Button
            key={option}
            {...radioProps(i)}
            // `null` drops the variant's own fill and hover, which would paint
            // over the swatch; the base keeps the focus ring and phone floor.
            variant={null}
            size="icon"
            role="radio"
            aria-checked={on}
            aria-label={labelFor(option)}
            title={labelFor(option)}
            disabled={disabled}
            onClick={() => {
              if (!on) onValueChange(option);
            }}
            className={cn(
              "size-11 rounded-full text-person-on md:size-8",
              PERSON_BG[option],
              on ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "ring-1 ring-hairline",
            )}
          >
            {on && <Check className="size-4" strokeWidth={3} aria-hidden />}
          </Button>
        );
      })}
    </div>
  );
}
