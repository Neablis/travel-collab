"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import type { TripHistory } from "@tc/contracts";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DataText } from "@/components/ui/data-text";
import { Panel } from "@/components/ui/panel";
import { Text } from "@/components/ui/text";

export function HistoryPanel({
  history,
  previewSeq,
  onPreview,
  onExitPreview,
  onRevert,
}: {
  history: TripHistory | null;
  previewSeq: number | null;
  onPreview: (seq: number) => void;
  onExitPreview: () => void;
  onRevert: (toSeq: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside>
      <Button variant="ghost" aria-label="History" onClick={() => setOpen((o) => !o)}>
        <Clock className="size-3.5" aria-hidden />
        History
      </Button>
      {open && history !== null && (
        <Panel title="History" className="mt-2">
          <ol reversed className="m-0 list-none divide-y divide-hairline p-0">
            {history.entries.map((entry) => (
              <li
                key={entry.batchId}
                data-testid="history-entry"
                className={cn("flex items-center justify-between gap-2 py-1.5", previewSeq === entry.toSeq && "bg-brand-tint")}
              >
                <Button
                  variant="ghost"
                  onClick={() => (previewSeq === entry.toSeq ? onExitPreview() : onPreview(entry.toSeq))}
                  className={cn(entry.undone && "opacity-50", previewSeq === entry.toSeq && "font-bold")}
                >
                  {entry.undone ? <s>{entry.description}</s> : entry.description}
                </Button>
                <DataText size="xs">{new Date(entry.occurredAt).toLocaleString()}</DataText>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {previewSeq !== null && (
        <Banner
          variant="info"
          className="mt-2"
          actions={
            <>
              <Button variant="secondary" onClick={() => onRevert(previewSeq)}>Revert to here</Button>
              <Button variant="ghost" onClick={onExitPreview}>Back to now</Button>
            </>
          }
        >
          <Text as="span">Viewing version {previewSeq} (read-only)</Text>
        </Banner>
      )}
    </aside>
  );
}
