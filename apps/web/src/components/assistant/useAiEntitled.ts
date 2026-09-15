"use client";

import { useEffect, useState } from "react";
import type { AccountPlanView } from "@/lib/accountPlan";
import { cachedRead, DEDUPE } from "@/lib/queryCache";
import type { ApiResult } from "@/lib/apiClient";

/**
 * **Does this account's plan include the assistant — asked BEFORE the first
 * question rather than learned from a refusal.**
 *
 * The rail already knew how to render a 402 (`askUpgrade`), and that was the
 * whole gate: a free account got a live-looking composer, typed a question,
 * and was told afterwards. Reported on the preview, 2026-09-15: *"the
 * assistant should still be openable but the input should be disabled, and the
 * text container above should be a CTA To upgrade"*. Disabling it needs the
 * answer up front, which is this.
 *
 * **`ai.ask`, not a plan id.** ADR-045 rule 4 — no surface compares plan
 * names, and `planVersions.fourthPlan.test.ts` walks source files for exactly
 * that comparison. A fourth plan that grants the assistant has to work here
 * with no edit, and it does, because this asks what the account HOLDS.
 *
 * **Returns `null` while unknown, and every caller must treat `null` as
 * entitled.** A hook that started `false` would grey out the composer for a
 * frame on every open, for everyone, including people who pay — flashing a
 * paywall at a subscriber is a worse failure than showing a free account one
 * live frame. `null` is also what a FAILED read resolves to, for the same
 * reason: the server refuses with 402 whatever this returns, so being wrong in
 * the permissive direction costs one refused request and being wrong in the
 * strict direction blocks a paying customer on a bad network.
 *
 * **No new endpoint and, in the common case, no new request.** It reads the
 * same `GET /api/account/plan` the account sheet does, through the shared
 * cache (ADR-046), so opening the assistant after opening the sheet joins a
 * stored result instead of asking again.
 */
export const AI_ASK_ENTITLEMENT = "ai.ask";

/** The cache key, spelled here and nowhere else — `queryKeys.ts`'s rule. */
export const accountPlanKey = "account:plan";

async function readAccountPlan(): Promise<ApiResult<AccountPlanView>> {
  const res = await fetch("/api/account/plan");
  if (!res.ok) {
    return { ok: false, error: { status: res.status, message: "could not read the plan" } };
  }
  const body = (await res.json()) as { plan: AccountPlanView };
  return { ok: true, value: body.plan };
}

export function useAiEntitled(): boolean | null {
  const [entitled, setEntitled] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void cachedRead(accountPlanKey, readAccountPlan, { dedupeMs: DEDUPE.NAVIGATION }).then(
      (result) => {
        // `live` guards a resolve arriving after unmount — the rail unmounts
        // the moment the assistant is closed, which is well inside the time a
        // cold read takes.
        if (!live) return;
        // **`entitlements`, which is what the account is CONFERRED** — the
        // resolver's post-lapse answer, not the version it pins. A lapsed
        // subscriber holds `premium` and is conferred `free`, and it is the
        // second one that decides whether a question will be answered.
        setEntitled(result.ok ? result.value.entitlements.includes(AI_ASK_ENTITLEMENT) : null);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return entitled;
}
