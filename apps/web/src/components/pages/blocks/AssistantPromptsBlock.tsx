"use client";
import type { AssistantPromptsPayload } from "@tc/pages";
import { usePhoneAsk } from "@/components/nav/phoneAsk";
import { Button } from "@/components/ui/button";

// "Ask" (M52 decision 15): one chip per day-of question. A tap opens the
// screen's Ask with the chip's whole question filled in (`PhoneAskEntry.onAsk`,
// the path ⌘K's *Ask* takes, with `prefill`), and sends nothing: "Running
// late" needs a "by how much" that only the reader can add, and a turn spent
// asking for it is a turn off their plan.
//
// While the page is being edited a chip would be a control that does nothing,
// so each is drawn as its label alone.
/** Ask: the day-of questions, one tap each to start one. */
export function AssistantPromptsBlock({ payload, interactive = true }: { payload: AssistantPromptsPayload; interactive?: boolean }) {
  const onAsk = usePhoneAsk()?.onAsk;
  return (
    <span role="group" aria-label="Ask the assistant" className="flex flex-wrap gap-2">
      {payload.prompts.map((prompt) =>
        interactive && onAsk ? (
          <Button key={prompt.label} size="sm" onClick={() => onAsk(prompt.text, { prefill: true })}>
            {prompt.label}
          </Button>
        ) : (
          <span key={prompt.label} className="rounded-md border border-hairline px-2.5 py-1 text-sm text-slate">
            {prompt.label}
          </span>
        ),
      )}
    </span>
  );
}
