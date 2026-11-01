"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchTurnTrace } from "@/lib/apiClient";
import type { TraceToolCall, TurnTrace } from "@/lib/askDebug";

// **The step timeline under an assistant turn** (M57 part 5, ADR-085): which
// persona ran each step, what it called and how that went, tokens, cache
// reads, the switch a step came in by, and what people did with the answer.
// Operators only, and only when Debug is on: the rail passes it through
// `renderTurnFooter`, and the endpoint behind it 404s to anyone else.
//
// Fetched on first expand, because a turn's ledger row is written after its
// last chunk. An operator who is quick can open it before the row lands, so a
// 404 is retried briefly; one that still finds nothing says so, and opening it
// again asks again. Any other failure says the breakdown could not be read,
// which is not the same claim as "this turn has no row".

/** `0.0123` dollars, from micro-dollars: a turn costs hundredths of a cent, so whole cents would show zero. */
function dollars(micro: number | null): string {
  return micro === null ? "unpriced" : `$${(micro / 1_000_000).toFixed(4)}`;
}

/** The ledger write trails the stream's last chunk by well under a second; a few tries cover it. */
const ROW_RETRIES = 3;
const ROW_RETRY_MS = 600;

const ms = (value: number | null) => (value === null ? "n/a" : `${value} ms`);
const count = (value: number | null) => (value === null ? "n/a" : String(value));

function Calls({ calls }: { calls: TraceToolCall[] }) {
  if (calls.length === 0) return <p className="text-slate">No tools called.</p>;
  return (
    <ul aria-label="Tools called" className="flex flex-col gap-0.5">
      {calls.map((call) => (
        <li key={call.callId}>
          <code>{call.tool}</code> {call.outcome}, {ms(call.durationMs)}
        </li>
      ))}
    </ul>
  );
}

function Timeline({ trace }: { trace: TurnTrace }) {
  return (
    <div className="flex flex-col gap-2 text-xs text-ink">
      <p>
        {trace.taskClass} turn, {trace.outcome}, entered as {trace.entryPersona ?? "an unrecorded persona"}. {ms(trace.latencyMs)}, {dollars(trace.costMicroUsd)}.
      </p>
      <ol aria-label="Steps" className="flex flex-col gap-2">
        {trace.steps.map((step) => (
          <li key={step.index} className="rounded-md border border-hairline px-2 py-1.5">
            <p className="font-semibold">
              Step {step.index + 1}: {step.persona ?? "unrecorded persona"}
              {step.crossed !== null && <span className="font-normal text-slate"> after a {step.crossed.kind} from {step.crossed.from}</span>}
              {step.escalated && <span className="font-normal text-slate"> (escalated)</span>}
              {step.pivoted && <span className="font-normal text-slate"> (pivoted)</span>}
            </p>
            <p className="text-slate">
              {step.model}, {count(step.tokensIn)} in ({count(step.cacheReadTokens)} cached), {count(step.tokensOut)} out, {ms(step.durationMs)}
              {step.finishReason !== null && `, ${step.finishReason}`}
            </p>
            <Calls calls={step.calls} />
          </li>
        ))}
      </ol>
      {trace.looseCalls.length > 0 && (
        <div>
          <p className="font-semibold">Calls with no recorded step</p>
          <Calls calls={trace.looseCalls} />
        </div>
      )}
      <div>
        <p className="font-semibold">Outcomes</p>
        {trace.outcomes.length === 0 ? (
          <p className="text-slate">None reported.</p>
        ) : (
          <ul aria-label="Outcomes">
            {trace.outcomes.map((outcome) => (
              <li key={outcome.kind}>{outcome.kind}</li>
            ))}
          </ul>
        )}
      </div>
      {trace.gaps.length > 0 && (
        <div>
          <p className="font-semibold">Handed off</p>
          <ul aria-label="Handed off">
            {trace.gaps.map((gap, index) => (
              // By position: one turn can hand the same task off twice.
              <li key={index}>
                {gap.persona} to {gap.target}: {gap.task}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Loaded = "idle" | "loading" | "missing" | "failed" | { trace: TurnTrace };

/**
 * The breakdown under one answer. `ordinal` is which answer it is in the
 * thread (from 1), so the button's name tells a screen reader which turn;
 * `touch` sizes it for the phone sheet.
 */
export function TurnBreakdown({ turnId, ordinal, touch = false }: { turnId: string; ordinal: number; touch?: boolean }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Loaded>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async () => {
    setState("loading");
    for (let attempt = 0; ; attempt++) {
      const got = await fetchTurnTrace(turnId);
      if (!mounted.current) return;
      if (got.ok) return setState({ trace: got.value });
      if (got.error.status !== 404) return setState("failed");
      if (attempt >= ROW_RETRIES) return setState("missing");
      await new Promise((resolve) => setTimeout(resolve, ROW_RETRY_MS));
      if (!mounted.current) return;
    }
  };

  const toggle = () => {
    setOpen(!open);
    // Opening asks again after a miss or a failure; it never re-asks a trace it has.
    if (!open && (state === "idle" || state === "missing" || state === "failed")) void load();
  };

  return (
    <div className="mt-1">
      <Button variant="ghost" size={touch ? "touch" : "sm"} aria-label={`Breakdown of answer ${ordinal}`} aria-expanded={open} aria-controls={panelId} onClick={toggle}>
        Breakdown
      </Button>
      <div id={panelId} hidden={!open} className="mt-1">
        {state === "loading" && <p className="text-xs text-slate">Reading the ledger…</p>}
        {state === "missing" && <p className="text-xs text-slate">No ledger row for this turn.</p>}
        {state === "failed" && <p className="text-xs text-slate">The breakdown could not be read.</p>}
        {typeof state === "object" && <Timeline trace={state.trace} />}
      </div>
    </div>
  );
}
