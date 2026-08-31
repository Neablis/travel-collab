"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "@/lib/apiClient";

/**
 * The three states project rule 6 asks every new route for — loading, a
 * sync failure with a working Retry, and a **conflict** — over one read.
 *
 * Shared by Discover, the shared day, the board and the profile because rule 6
 * is a per-route obligation and four hand-rolled copies of it would be four
 * chances to get the third one wrong. The first two are ordinary; the third is
 * the one worth explaining.
 *
 * **The conflict is "the library moved while you were looking at it."** These
 * are read surfaces over data other people are changing: a day is published,
 * withdrawn, or taken into a trip while your page sits open, and the numbers on
 * it quietly stop being true. `changed` goes true when a RELOAD returns
 * something different from what is already on screen — never on the first load,
 * where there is nothing to have moved.
 *
 * **Conflicts are data, not errors** (invariant 3). It is a line on the page,
 * never a modal and never a refusal: the new data is shown, and the line says
 * that it is new. Dismissing it is the reader's call.
 *
 * `signature` is what "different" means for a given surface — a caller decides
 * whether a changed `adds` count is worth mentioning or only a changed day
 * list. Comparing whole payloads would fire on every irrelevant field and
 * retrain everyone to ignore the line, which is the disease `witness.ts`
 * describes for flapping test floors.
 *
 * **A new `read` is a new QUESTION, and an answer to a different question is
 * not the library moving.** Discover rebuilds `read` on every filter change, so
 * comparing the new query's answer against the old query's signature made the
 * banner fire on essentially every interaction — the same "retrain everyone to
 * ignore the line" failure, arrived at from the other side (CodeRabbit,
 * PR 102). The baseline is therefore reset whenever `read` changes identity, and
 * kept across `reload()`, which is the only call that re-asks the SAME
 * question.
 */
export type LibraryRead<T> = {
  data: T | null;
  loading: boolean;
  /** The failure message, or null. Rendered beside a Retry that calls `reload`. */
  error: string | null;
  /** True when a reload brought back a different `signature` than was on screen. */
  changed: boolean;
  reload: () => void;
  acknowledgeChange: () => void;
};

export function useLibraryRead<T>(
  read: () => Promise<ApiResult<T>>,
  signature: (value: T) => string,
): LibraryRead<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  // The signature that is CURRENTLY ON SCREEN, in a ref rather than in state:
  // the comparison happens inside an async callback, and reading it from state
  // there would compare against whatever was captured when the callback was
  // created rather than what the reader is actually looking at.
  const onScreen = useRef<string | null>(null);

  // Only the latest read may write. Two loads can be in flight at once —
  // typing into Discover's city box while a Retry is still resolving — and
  // without this the slower one wins and the page shows the older answer, which
  // is the "results for the previous keystroke" bug in its usual disguise.
  const generation = useRef(0);

  const run = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    const result = await read();
    if (mine !== generation.current) return;
    setLoading(false);
    if (!result.ok) {
      // The previous data is deliberately LEFT on screen under the failure
      // banner. A dropped connection is not a reason to blank a page that was
      // showing something true a second ago; the banner says it may be stale.
      setError(result.error.message);
      return;
    }
    // Cleared on success, for TravelersPanel's reason: a retry that worked must
    // not leave the previous failure sitting next to fresh, correct data.
    setError(null);
    const next = signature(result.value);
    if (onScreen.current !== null && onScreen.current !== next) setChanged(true);
    onScreen.current = next;
    setData(result.value);
  }, [read, signature]);

  useEffect(() => {
    // Not inside `run`: `reload()` calls it too, and that is exactly the call
    // whose baseline must survive. This effect fires only when `read` (or
    // `signature`) changes identity — a new question.
    onScreen.current = null;
    setChanged(false);
    void run();
  }, [run]);

  return {
    data,
    loading,
    error,
    changed,
    reload: () => void run(),
    acknowledgeChange: () => setChanged(false),
  };
}
