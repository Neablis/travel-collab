// Pure helpers for Gate 2 (quality parity at lower cost). No I/O, no model
// calls — the paid eval (`planRetrieval.gate2.eval.ts`) imports these, and
// the free unit tests cover them.

/**
 * Build the plan prompt for one query, with or without examples.
 * The ONLY variable between arms A and B is the example block — this isolates
 * the retrieval effect for an honest token comparison.
 */
export function buildPlanPrompt(query: string, exampleText: string | null): string {
  const examples = exampleText
    ? `\n\nHere are example days from similar trips. Adapt them to the request — do not copy them verbatim, and the user's request wins if there's a conflict:\n\n${exampleText}\n`
    : "";
  return `You are a travel planner. Write a day-by-day itinerary.${examples}\nUser request: "${query}"\n\nWrite the itinerary now, one section per day with concrete places and activities.`;
}

/**
 * The judge prompt: compare two plans for the same query.
 */
export function buildJudgePrompt(query: string, planA: string, planB: string): string {
  return `You are judging two trip plans for the same request. Be strict but fair.

Request: "${query}"

--- PLAN A ---
${planA}

--- PLAN B ---
${planB}

Rate each plan 1-5 on:
1. Completeness: covers the requested duration/days
2. Specificity: concrete places and activities, not generic filler
3. Coherence: logical geographic and temporal flow
4. Relevance: matches the request's theme and constraints

Then give a verdict on ONE line: "VERDICT: A_BETTER" or "VERDICT: B_BETTER" or "VERDICT: TIE".
A TIE means the plans are of equal quality — minor differences don't break the tie.
Explain your ratings briefly before the verdict line.`;
}

/** The judge's verdict for one comparison. */
export type JudgeVerdict = "A_BETTER" | "B_BETTER" | "TIE";

/**
 * Extract the verdict line from judge output.
 * Fail-open to TIE (not A_BETTER) — an unparseable judge must not silently
 * claim the baseline won.
 */
export function extractVerdict(judgeText: string): JudgeVerdict {
  const match = judgeText.match(/VERDICT:\s*(A_BETTER|B_BETTER|TIE)/);
  if (!match) return "TIE";
  return match[1] as JudgeVerdict;
}
