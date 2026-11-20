"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";

// The ten recovery codes, shown once (M62 D6). Turning two-step sign-in on is not
// finished until the person ticks that they saved them, and nothing closes this
// before then: the codes are not stored anywhere they can be read back, so a stray
// Esc or a click outside would lose the only copy. (The revoke-everything tick
// from D8 joins this sheet in part 4.)
/** The recovery codes, with Download, Copy and the tick that lets Done through. */
export function RecoveryCodesSheet({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const text = codes.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      // Clipboard access is refused outside a secure context or without
      // permission; Download is the way out, and the codes are on screen.
      setCopied("failed");
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`Caesura recovery codes\nEach works once.\n\n${text}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "caesura-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onOpenChange={(open) => (open || !saved ? undefined : onDone())} title="Save your recovery codes">
      <div className="flex flex-col gap-4">
        <Text variant="secondary">
          Each code works once. If you lose your passkey, a code gets you back in. They are shown only now, so keep them
          somewhere safe.
        </Text>
        <ol aria-label="Recovery codes" className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md bg-moss p-3 font-mono text-sm text-ink">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={download}>
            Download
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            Copy
          </Button>
          <Text as="span" variant="muted" role="status">
            {copied === "copied" ? "Copied." : copied === "failed" ? "Could not copy. Download them instead." : ""}
          </Text>
        </div>
        <CheckboxField checked={saved} onCheckedChange={setSaved} title="I saved these" />
      </div>
      <DialogFooter>
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
