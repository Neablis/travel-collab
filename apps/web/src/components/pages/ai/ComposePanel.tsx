"use client";
import { useEffect, useRef, useState } from "react";
import type { PageDoc } from "@tc/contracts";
import { askAssistant, ASK_ABORTED_CODE } from "@/lib/apiClient";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Status = "idle" | "loading" | "error";

// A prompt box that asks the assistant to draft THIS page, and hands the result
// to `onApply` — the same content-setter PageScreen wires to PageEditor's
// `onChange`, so the draft lands in the editor for the user to review and edit
// before the existing debounced autosave persists it. This panel never calls
// updatePage itself.
//
// **It talks to /ask now, not to the command endpoint** (ADR-033 Decision 4).
// That is a rewrite rather than a re-point, and the ADR says so: it awaited a
// non-streaming `{ content }`, and the agent streams. What it gets for that is
// a server that VERIFIES which page it is drafting rather than accepting a
// `pageContext` off the request body, and a tool set narrowed to reading plus
// `compose_page` — a turn from here cannot touch the board at all.
//
// It sends ONE message and keeps no thread. The rail's conversation is a
// conversation; this is a single instruction about one document, and a page
// that accumulated turns would have to decide what "draft this page" means the
// second time. `pageId` is all the context it sends — everything else about the
// page (its title, its day binding) the server reads from the row.
type ComposePanelProps = {
  tripId: string;
  pageId: string;
  onApply: (content: PageDoc) => void;
};

export function ComposePanel({ tripId, pageId, onApply }: ComposePanelProps) {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // True when the last draft was composed by the server because the ai-live
  // flag is off — the draft is real, the authorship is not a model. Read from
  // the response header the server sets, never sniffed out of the prose
  // (`SIMULATED_HEADER`, handleAskRequest.ts).
  const [simulated, setSimulated] = useState(false);
  // Only one draft can be in flight (the button and Enter are both disabled
  // while loading), so one ref is enough to hold the turn still running on the
  // operator's key.
  const abort = useRef<AbortController | null>(null);

  // **The cleanup is what makes the sentence above true.** Until it existed,
  // this ref was written and never read: nothing called `abort()`, so the
  // claim that unmounting stops a turn was a comment with nothing enforcing it
  // — the species AGENTS.md names, and caught here by two reviewers rather
  // than by a test.
  //
  // Keyed on `tripId`/`pageId`, not just unmount, because the panel does NOT
  // unmount when the Notebook moves to a different page: it re-renders with
  // new props. A turn started for the old page would otherwise still be
  // running, and its draft would land in the page now on screen.
  //
  // Resetting status here is part of the same fix: an aborted turn returns
  // through the `ASK_ABORTED_CODE` branch below, which deliberately shows
  // nothing, so without this the freshly-pointed panel would sit on the
  // previous page's "loading" forever.
  useEffect(() => {
    setStatus("idle");
    setError(null);
    return () => {
      abort.current?.abort();
      abort.current = null;
    };
  }, [tripId, pageId]);

  const submit = async () => {
    if (prompt.trim() === "") return;
    setStatus("loading");
    setError(null);
    setSimulated(false);

    // Accumulated here rather than read off the resolved value, because a turn
    // that streams a page and THEN fails still drafted a usable page — and
    // throwing it away under the user is the worse lie.
    let composed: PageDoc | null = null;
    let refusal: string | null = null;

    const controller = new AbortController();
    abort.current = controller;
    const result = await askAssistant(
      tripId,
      [{ id: "compose", role: "user", parts: [{ type: "text", text: prompt }] }],
      { kind: "page", pageId },
      (event) => {
        if (event.type === "meta") setSimulated(event.simulated);
        // The doc is already validated against the macro registry server-side
        // and re-parsed against `PageDoc` on the way in, so there is
        // nothing left here to check before showing it.
        else if (event.type === "page") composed = event.content;
        else if (event.type === "page-error") refusal = event.message;
      },
      controller.signal,
    );

    // **Identity, not a mounted flag.** The cleanup above clears the ref, so
    // `abort.current !== controller` is exactly "this turn was abandoned" —
    // whether by unmount or by the panel being re-pointed at another page. A
    // mounted flag would not do: on a re-point the panel stays mounted, so a
    // stale turn would pass the check and apply the previous page's draft to
    // the one now on screen.
    if (abort.current !== controller) return;
    abort.current = null;

    if (composed !== null) {
      onApply(composed);
      setStatus("idle");
      setPrompt("");
      return;
    }

    // Abandoned deliberately — a second submit, or the panel going away. Not an
    // error, and there is nobody left to show one to.
    if (!result.ok && result.error.code === ASK_ABORTED_CODE) return;

    // `refusal` first: when the server says why it could not draft a page
    // ("Macro "cost.day" params failed validation…"), that is a better answer
    // than the transport-level one, which will just say the turn succeeded.
    setError(refusal ?? (result.ok ? "The assistant didn't draft a page. Try asking again." : result.error.message));
    setStatus("error");
  };

  const inputId = `compose-panel-prompt-${pageId}`;

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
