"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
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
 */
export function SaveAsTemplate({ tripId, pageId, title }: { tripId: string; pageId: string; title: string }) {
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
    setOpen(false);
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>
        Save as template
      </Button>
      {saved !== null && (
        <Text as="span" variant="secondary" role="status">
          Saved “{saved}” to your templates
        </Text>
      )}
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
