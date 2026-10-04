"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { SUGGESTION_NOTE_MAX } from "@tc/contracts";
import type { SuggestionDraft } from "@/components/trip/context/TripProvider";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/**
 * A suggester's unsent draft (spec §2.3), as the bar pinned to the bottom of
 * the board: how many edits are held, and the two things to do with them.
 * Props-only, like `Board`, so its test needs no provider; `TripBoardScreen`
 * hands it the provider's `draft` and mounts it where the Unscheduled rack is
 * for everyone else (W69, W71).
 *
 * Always drawn in suggest mode, an empty draft included: the bar is where a
 * suggester learns that their edits wait for them to send them.
 */
export function SuggestionTray({ draft }: { draft: SuggestionDraft }) {
  const [note, setNote] = useState("");
  // The note is optional, and the field is ~100px of a phone's board for as
  // long as the bar is pinned, so it waits behind the bar's own expander — the
  // rack's caret, in the rack's place.
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const Caret = open ? ChevronDown : ChevronRight;
  const empty = draft.count === 0;

  const send = async () => {
    // Cleared only once stored: a refused draft keeps the note with it.
    if (await draft.send(note)) {
      setNote("");
      setOpen(false);
    }
  };
  // The note goes with the draft it described. This bar stays mounted at a
  // count of 0, so without this it would come back with the next edit.
  const discard = () => {
    setNote("");
    setOpen(false);
    draft.discard();
  };

  return (
    // `.unscheduled-rack` is the pinning, not the rack: fixed above the phone
    // tab bar and short of a docked assistant rail (globals.css). Reusing it
    // is what lets every measured offset that clears the rack — the assistant
    // bubble, the toast, the river's drag band, the Map canvas — clear this
    // bar too, through the same `--rack-height`.
    <section aria-label="Suggestion draft" className="unscheduled-rack z-20 border-t border-hairline bg-surface">
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
        // eslint-disable-next-line no-restricted-syntax -- the rack's design-fixed 9px/26px toggle-row padding, so the bar is the same height in the same place
        style={{ padding: "9px 26px" }}
      >
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={open ? noteId : undefined}
          onClick={() => setOpen((o) => !o)}
          disabled={empty}
          className="h-auto min-w-0 justify-start gap-3 rounded-none p-0 text-left hover:bg-transparent"
        >
          <Caret
            aria-hidden
            className="shrink-0 text-ink"
            // eslint-disable-next-line no-restricted-syntax -- the rack's own 13px caret in a 15px line box, which no spacing token spells
            style={{ width: "13px", height: "15px" }}
          />
          <span className="text-sm font-semibold text-ink">
            {empty ? "No changes yet" : draft.count === 1 ? "1 change not sent" : `${draft.count} changes not sent`}
          </span>
          {/* Off a phone only: at 390px the line and both buttons fit one
              row only without it, and W69's bar is one row tall there (the
              #314 preview walk measured two, 115px). The count says the rest. */}
          <span className="text-xs font-normal text-slate max-md:hidden">
            {empty ? "Your edits are sent as a suggestion" : "Add a note"}
          </span>
        </Button>
        <div className="flex shrink-0 gap-2">
          {!empty && (
            <Button variant="secondary" size="sm" onClick={discard} disabled={draft.sending}>
              <X aria-hidden className="size-3.5 md:hidden" />
              <span className="max-md:sr-only">Discard</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            aria-label="Send suggestion"
            onClick={() => void send()}
            disabled={draft.sending || empty}
          >
            Send<span className="max-md:hidden"> suggestion</span>
          </Button>
        </div>
      </div>
      {open && (
        <div id={noteId} className="px-6 pb-3">
          <FormField id="suggestion-note" label="Note for the planners" hint="Optional">
            <Textarea
              id="suggestion-note"
              value={note}
              maxLength={SUGGESTION_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-12"
            />
          </FormField>
        </div>
      )}
      {draft.error !== null && (
        <div className="px-6 pb-3">
          <Banner variant="danger">{draft.error}</Banner>
        </div>
      )}
    </section>
  );
}
