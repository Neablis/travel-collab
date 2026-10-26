import type { TripPeoplePayload } from "@tc/pages";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { Text } from "@/components/ui/text";

// "Who's going" (M38, canvas artboard 5): the shared stack of the people the
// sentence names, then the sentence. The faces are decorative — the names are
// in the sentence — and each names itself in a tip for a pointer. The resolver
// already stops the stack at three and counts the rest in words, so this one
// never shows a "+N".
//
// Spans rather than `<div>`s, `TripStripBlock`'s reason: a widget node is an
// inline atom and renders inside a paragraph.
/** Who's going: a chip stack and the sentence naming everyone travelling. */
export function TripPeopleBlock({ payload }: { payload: TripPeoplePayload }) {
  return (
    <span className="flex items-center gap-3">
      <AvatarStack
        className="shrink-0"
        people={payload.stack.map((person, index) => ({ ...person, id: `${person.name}-${index}` }))}
      />
      <Text as="span" className="text-pretty text-slate">
        {payload.sentence}
      </Text>
    </span>
  );
}
