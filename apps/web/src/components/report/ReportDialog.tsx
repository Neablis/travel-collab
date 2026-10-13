"use client";

import { useRef, useState } from "react";
import { REPORT_NOTE_MAX, type ReportReason, type ReportTarget } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { createReport } from "@/lib/apiClient";

// Reporting a shared day or a review (M12 link 6). **Not drawn in the design**,
// so it is deliberately quiet: a small ghost "Report" beside the thing, and a
// dialog. The server makes a repeat report idempotent, so nothing here has to
// remember what this reader already reported.

const REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam or advertising" },
  { value: "offensive", label: "Offensive or hateful" },
  { value: "unsafe", label: "Unsafe — it could get someone hurt" },
  { value: "inaccurate", label: "Wrong or misleading" },
  { value: "other", label: "Something else" },
];

type Outcome = { kind: "idle" } | { kind: "sent" } | { kind: "own" } | { kind: "failed" };

/**
 * A ghost "Report" button that opens the report dialog for `target`. `name` is
 * what the button's accessible name says it reports ("this day", "Mei's
 * review"), because a page with a Report under every review needs each one to
 * say which.
 */
export function ReportAction({ target, name }: { target: ReportTarget; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={`Report ${name}`} onClick={() => setOpen(true)}>
        Report
      </Button>
      {/* Mounted only while open, so every opening starts from a blank form. */}
      {open && <ReportDialog target={target} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ target, name, onClose }: { target: ReportTarget; name: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  // Refused rather than cut, the review note's rule applied to this one: the
  // contract counts code points after trimming, so this does too.
  const noteOver = [...note.trim()].length > REPORT_NOTE_MAX;

  async function send() {
    if (reason === null) return;
    setBusy(true);
    const result = await createReport({ target, reason, note: note.trim() === "" ? null : note.trim() });
    setBusy(false);
    // 201 (filed) and 200 (already on file) read the same to the reporter.
    if (result.ok) setOutcome({ kind: "sent" });
    else setOutcome({ kind: result.error.status === 403 ? "own" : "failed" });
  }

  const done = outcome.kind === "sent" || outcome.kind === "own";
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title={`Report ${name}`}>
      {outcome.kind === "sent" ? (
        <Text variant="secondary" data-testid="report-sent">
          Thanks — an operator will look at it.
        </Text>
      ) : outcome.kind === "own" ? (
        <Text variant="secondary">This is yours, so there is nothing to report.</Text>
      ) : (
        <div className="flex flex-col gap-3">
          <ReasonGroup value={reason} onChange={setReason} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-note">Anything an operator should know (optional)</Label>
            <Textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} />
            {noteOver && (
              <Text variant="muted" className="text-danger-ink">
                Keep it to {REPORT_NOTE_MAX} characters.
              </Text>
            )}
          </div>
          {outcome.kind === "failed" && (
            <Text variant="muted" className="text-danger-ink">
              That report did not send. Try again.
            </Text>
          )}
        </div>
      )}
      <DialogFooter>
        {done ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={reason === null || noteOver || busy} onClick={() => void send()}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/**
 * The five reasons as one radio group. Buttons with `role="radio"` rather than
 * native inputs, because the element wall refuses a raw `<input>` and there is
 * no radio primitive — so this owes what a native group gives for free: one tab
 * stop, and arrows that move the choice (WidgetPicker's roving `tabIndex`).
 */
function ReasonGroup({ value, onChange }: { value: ReportReason | null; onChange: (next: ReportReason) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = Math.max(0, REASONS.findIndex((r) => r.value === value));
  const moveTo = (next: number) => {
    const i = (next + REASONS.length) % REASONS.length;
    onChange(REASONS[i]!.value);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Why are you reporting it?" className="flex flex-col gap-1">
      <Text variant="secondary" aria-hidden>
        Why are you reporting it?
      </Text>
      {REASONS.map((r, i) => {
        const on = value === r.value;
        return (
          <Button
            key={r.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            variant="ghost"
            role="radio"
            aria-checked={on}
            tabIndex={i === focusIndex ? 0 : -1}
            className={cn("justify-start text-left", on && "bg-brand-tint text-ink")}
            onClick={() => onChange(r.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                moveTo(i + 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                moveTo(i - 1);
              }
            }}
          >
            <span aria-hidden className={cn("size-3 shrink-0 rounded-full border border-border-input", on && "border-brand bg-brand")} />
            {r.label}
          </Button>
        );
      })}
    </div>
  );
}
