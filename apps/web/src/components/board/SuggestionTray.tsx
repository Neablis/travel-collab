"use client";

import { useState } from "react";
import { SUGGESTION_NOTE_MAX } from "@tc/contracts";
import type { SuggestionDraft } from "@/components/trip/context/TripProvider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";

/**
 * A suggester's unsent draft (spec §2.3): how many edits are held, and the two
 * things to do with them. Props-only, like `Board`, so its test needs no
 * provider; `TripBoardScreen` hands it the provider's `draft`.
 *
 * Nothing at all with an empty draft — the board itself is the record of what
 * a suggester has not changed.
 */
export function SuggestionTray({ draft }: { draft: SuggestionDraft }) {
  const [note, setNote] = useState("");
  if (draft.count === 0) return null;

  const send = async () => {
    // Cleared only once stored: a refused draft keeps the note with it.
    if (await draft.send(note)) setNote("");
  };

  return (
    <section aria-label="Suggestion draft" className="mt-3 flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="span" className="font-semibold text-ink">
          {draft.count === 1 ? "1 change not sent" : `${draft.count} changes not sent`}
        </Text>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={draft.discard} disabled={draft.sending}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={() => void send()} disabled={draft.sending}>
            Send suggestion
          </Button>
        </div>
      </div>
      <FormField id="suggestion-note" label="Note for the planners" hint="Optional">
        <Textarea
          id="suggestion-note"
          value={note}
          maxLength={SUGGESTION_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-12"
        />
      </FormField>
      {draft.error !== null && <Banner variant="danger">{draft.error}</Banner>}
    </section>
  );
}
