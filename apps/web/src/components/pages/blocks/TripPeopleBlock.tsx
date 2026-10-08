import type { TripPeoplePayload } from "@tc/pages";
import { PersonChip } from "@/components/ui/person-chip";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";

// "Who's going" (M38, canvas artboard 5): an overlapping `md` stack of the
// people the sentence names, then the sentence. Each chip is decorative, as
// `PersonChip` always is — the names are in the sentence — and carries the full
// name as its title for a pointer. The 2px ring is the canvas's rule for a
// stack, so overlapping chips still read as separate people.
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph.
/** Who's going: a chip stack and the sentence naming everyone travelling. */
export function TripPeopleBlock({ payload }: { payload: TripPeoplePayload }) {
  return (
    <span className="flex items-center gap-3">
      <span className="flex shrink-0">
        {payload.stack.map((person, index) => (
          <PersonChip
            key={`${person.name}-${index}`}
            name={person.name}
            avatar={person.avatar}
            color={person.color}
            title={person.name}
            size="md"
            ring
            className={cn(index > 0 && "-ml-2")}
          />
        ))}
      </span>
      <Text as="span" className="text-pretty text-slate">
        {payload.sentence}
      </Text>
    </span>
  );
}
