"use client";
import { useState } from "react";
import type { PageContent, PageContext } from "@tc/contracts";
import { composeAiPage, composeAiPlan, type CommandOutcome } from "@/lib/apiClient";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Status = "idle" | "loading" | "error";

// Task 5.5: a prompt box that POSTs to /api/trips/:id/ai and applies the
// result. Two surfaces, two callback shapes — deliberately not one generic
// "onResult" prop, since the two surfaces' results are genuinely different
// things (a doc to review vs. a trip that already changed):
//
//   - `surface="page"`: the returned PageContent is handed to `onApply`,
//     the same content-setter PageScreen wires to PageEditor's `onChange`
//     (Task 4.4) — the model's draft lands in the editor for the user to
//     review/edit before the existing debounced autosave persists it. This
//     panel never calls updatePage itself.
//   - `surface="board"`/`"combined"`: the server already executed the
//     model's tool calls as one atomic batch (Task 5.3/5.4) before
//     responding, so there's nothing left to "apply" — `onApplied` hands the
//     caller the resulting `{ detail, history }` so it can reconcile board
//     state directly (TripProvider's `dispatch`/`dispatchBatch` predict
//     locally from commands the client itself sent; this command was decided
//     server-side, so the client never held it to predict — reconciling from
//     the authoritative response is correct, and it's already in hand, so no
//     refetch is needed). Reconciling in place (not a page reload) keeps this
//     panel mounted so the summary below stays on screen.
type PageProps = {
  tripId: string;
  surface: "page";
  pageContext: PageContext;
  onApply: (content: PageContent) => void;
};
type PlanProps = {
  tripId: string;
  surface: "board" | "combined";
  onApplied: (outcome: CommandOutcome) => void;
};

export function ComposePanel(props: PageProps | PlanProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // The board/combined surface's summary of what the AI just did. Kept in this
  // panel's own state (not a transient toast) so it stays visible after the
  // board refetches in place — the user's confirmation of the applied edit.
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (prompt.trim() === "") return;
    setStatus("loading");
    setError(null);
    setMessage(null);

    if (props.surface === "page") {
      const result = await composeAiPage(props.tripId, prompt, props.pageContext);
      if (!result.ok) {
        setError(result.error.message);
        setStatus("error");
        return;
      }
      props.onApply(result.value);
      setStatus("idle");
      setPrompt("");
      return;
    }

    const result = await composeAiPlan(props.tripId, prompt, props.surface);
    if (!result.ok) {
      setError(result.error.message);
      setStatus("error");
      return;
    }
    setMessage(result.value.message);
    props.onApplied(result.value);
    setStatus("idle");
    setPrompt("");
  };

  const inputId = `compose-panel-prompt-${props.surface}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface p-3">
      <Label htmlFor={inputId}>
        {props.surface === "page" ? "Ask AI to draft this page" : "Ask AI to plan"}
      </Label>
      <Textarea
        id={inputId}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          props.surface === "page"
            ? "e.g. Add a packing checklist and the day-by-day itinerary"
            : "e.g. Add two more days and move dinner to day 2"
        }
        disabled={status === "loading"}
      />
      {error !== null && <p role="alert" className="text-sm text-danger">{error}</p>}
      {message !== null && message !== "" && (
        <p role="status" className="text-sm text-slate">{message}</p>
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
