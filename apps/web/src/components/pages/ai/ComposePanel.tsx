"use client";
import { useState } from "react";
import type { PageContent, PageContext } from "@tc/contracts";
import { composeAiPage } from "@/lib/apiClient";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Status = "idle" | "loading" | "error";

// Task 5.5: a prompt box that POSTs to /api/trips/:id/ai and hands the result
// to `onApply` — the same content-setter PageScreen wires to PageEditor's
// `onChange` (Task 4.4), so the model's draft lands in the editor for the user
// to review/edit before the existing debounced autosave persists it. This panel
// never calls updatePage itself.
//
// Page-only since ADR-033 Decision 4. It used to serve the board/combined
// surfaces too, through a second `onApplied` callback shape — those surfaces
// had no caller and retired with `composeAiPlan`. Changing the trip itself is
// /ask's propose → review → approve now, not a panel that rewrites the board on
// submit.
type PageProps = {
  tripId: string;
  surface: "page";
  pageContext: PageContext;
  onApply: (content: PageContent) => void;
};

export function ComposePanel(props: PageProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // True when the last draft was composed by the server because the ai-live
  // flag is off — the draft is real, the authorship is not a model.
  const [simulated, setSimulated] = useState(false);

  const submit = async () => {
    if (prompt.trim() === "") return;
    setStatus("loading");
    setError(null);
    setSimulated(false);

    const result = await composeAiPage(props.tripId, prompt, props.pageContext);
    if (!result.ok) {
      setError(result.error.message);
      setStatus("error");
      return;
    }
    setSimulated(result.value.simulated);
    props.onApply(result.value.content);
    setStatus("idle");
    setPrompt("");
  };

  const inputId = `compose-panel-prompt-${props.surface}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface p-3">
      <Label htmlFor={inputId}>Ask AI to draft this page</Label>
      <Textarea
        id={inputId}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        // Enter submits (matching a chat-style prompt box); Shift+Enter still
        // inserts a newline for a genuinely multi-line request.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="e.g. Add a packing checklist and the day-by-day itinerary"
        disabled={status === "loading"}
      />
      {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
      {simulated && (
        <Badge variant="info" role="status">
          Simulated
        </Badge>
      )}
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={status === "loading" || prompt.trim() === ""}
        >
          {status === "loading" ? "Thinking…" : "Generate"}
        </Button>
      </div>
    </div>
  );
}
