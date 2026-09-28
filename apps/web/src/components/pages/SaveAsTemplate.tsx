"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import { PennantButton, usePennantCelebration } from "@/components/ui/pennant";
import { saveNotebookAsTemplate } from "@/lib/savedNotebooksClient";
import { submitOnEnter } from "@/lib/submitOnEnter";

/**
 * *Save as template* on an open notebook (M14 link 10): keeps this page in the
 * reader's own library, to start a notebook from in a future trip.
 *
 * The name defaults to the page's title, and the dialog opens focused on it so
 * accepting the default is one Enter — `KeepDayDialog`'s shape for the same
 * question. What is kept is what the server has STORED, not what is on screen —
 * and an open edit session has not reached the log yet (ADR-036: one write per
 * session, on leaving Editing). So `PageScreen` offers this in Reading only,
 * where the two are the same document.
 *
 * Drawn as a pennant at the top right of the notebook rather than a toolbar
 * button: the keep-a-day flag's circle, wave, celebration and toast.
 */
export function SaveAsTemplate({ tripId, pageId, title }: { tripId: string; pageId: string; title: string }) {
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { run, celebrate } = usePennantCelebration();

  const openDialog = () => {
    setName(title);
    setError(null);
    setOpen(true);
  };

  async function save() {
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Give the template a name.");
      return;
    }
    setBusy(true);
    const result = await saveNotebookAsTemplate({ tripId, pageId, title: trimmed });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(result.value.title);
    celebrate();
    setOpen(false);
  }

  return (
    <>
      {/* Mitchell, PR #269 preview: *"Lets do better then just a bunch of
          buttons, Maybe a flag like when saving a day for saving a notebook on
          the top right of the notebook"*. So this is the keep-a-day pennant
          rather than one more button in the toolbar: same circle, same wave,
          same celebration once the save lands, and the name a screen reader
          hears is still the words the button used to show. */}
      <PennantButton
        label="Save as template"
        title="Save as template"
        inkClassName="text-brand-pressed"
        run={run}
        celebrationTestId="save-template-celebration"
        onPress={openDialog}
      />
      {/* A toast rather than the line of text that used to sit beside the
          button: the pennant shares a row with the notebook's title, which has
          no room for a sentence, and the toast is how the day pennant says the
          same thing. Same words, same `status` role. */}
      {saved !== null && <Toast message={`Saved “${saved}” to your templates`} onDismiss={() => setSaved(null)} />}
      <Dialog open={open} onOpenChange={setOpen} title="Save as template">
        <div className="flex flex-col gap-3">
          <Text variant="secondary">
            Start a notebook from this one in any of your trips. Only you can see your templates.
          </Text>
          <FormField id={nameId} label="Name">
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={submitOnEnter(() => {
                if (!busy) void save();
              })}
            />
          </FormField>
          {error !== null && (
            <Text as="span" role="alert" className="text-xs text-danger-ink">
              {error}
            </Text>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
            Save template
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
