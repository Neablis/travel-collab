// **What the operator PAYS, dated and append-only** (M20 link 9).
//
// The mirror image of `planVersions.ts`, deliberately and in the same shape:
// two dated, append-only records — one for what the operator pays (this file)
// and one for what the operator charges (that one) — so **margin is a join
// across both as at a point in time** rather than a number computed once and
// frozen. Neither history is ever rewritten when a price moves.
//
// A committed file rather than a table, for the reasons ADR-045 gives for the
// other half and one more: rates are operator facts that change a handful of
// times a year, nobody edits them from a browser, and **a rate change that
// silently re-prices history is exactly the diff review should see.**
//
// **Micro-dollars per million tokens, as integers.** Not `Money` — ADR-008's
// integer minor units are whole cents, and $0.13 per MTok is a thirteenth of a
// cent per… nothing expressible. Not floats either: a rate table read as
// `0.13` and multiplied by token counts accumulates error across a month of
// rows, and the whole point of re-deriving is that two derivations of the same
// month agree. `130_000` micro-dollars per MTok is exact and stays exact.
//
// Rates corrected 2026-09-12 against the live catalogue
// (`curl https://ai-gateway.vercel.sh/v1/models`). The milestone's own table
// read $0.22/$0.66 for the turn model, overstating input by 1.7x and output by
// 2.5x, and every figure derived from it was wrong. These are the **US
// regional** rates; the same ids are cheaper again at the base rate, so they
// are the conservative numbers.
//
// **Vercel AI Gateway charges no markup and no platform fee on tokens** — the
// list price IS the billed price, which is why a public catalogue is a usable
// source for what an account actually cost.

/** One model's rate, as published on one date. */
export interface ModelRate {
  /** The RESOLVED gateway model id, matching `ai_usage.turn_model` exactly. */
  model: string;
  /**
   * The date this rate took effect, ISO. Append a new entry when a rate moves;
   * never edit one. A month re-derived tomorrow must produce what it produced
   * today.
   */
  effectiveFrom: string;
  /** Micro-dollars per million input tokens. */
  inputMicroUsdPerMTok: number;
  /** Micro-dollars per million output tokens. */
  outputMicroUsdPerMTok: number;
  /**
   * Micro-dollars per million input tokens read from the prompt cache
   * (M31 Phase 1). Absent means the catalogue lists no cached-read price, and
   * cached reads are then priced as fresh input, which overstates. Prompt
   * caching (`caching: "auto"`) makes most of a long turn's input a cached
   * read, so without this a turn's price is several times what was billed.
   */
  cacheReadInputMicroUsdPerMTok?: number;
  /**
   * Micro-dollars per million input tokens WRITTEN to the prompt cache. Some
   * providers charge a premium for these (Anthropic: 1.25x input). Absent,
   * cache writes are priced as fresh input — which UNDERSTATES for such a
   * provider, so a model that charges a premium needs this on its entry.
   */
  cacheWriteInputMicroUsdPerMTok?: number;
}

/**
 * Every rate ever published, append-only.
 *
 * Deliberately NOT keyed by model: two entries for the same model on different
 * dates is the normal case and the whole reason this file exists.
 */
export const MODEL_RATES: readonly ModelRate[] = [
  {
    model: "deepseek/deepseek-v4-flash-0731",
    effectiveFrom: "2026-08-16",
    inputMicroUsdPerMTok: 130_000,
    outputMicroUsdPerMTok: 260_000,
  },
  {
    model: "zai/glm-4.7-flash",
    effectiveFrom: "2026-08-16",
    inputMicroUsdPerMTok: 70_000,
    outputMicroUsdPerMTok: 400_000,
  },
  {
    // The compiled default (`config.ts`). Production does not run it, and the
    // milestone records what assuming otherwise cost: an estimate wrong by an
    // order of magnitude. It is priced here anyway, because a deployment that
    // sets none of the tier variables (nor `AI_MODEL`, their shared fallback)
    // really does run it, and a row nobody can price is worse than a row
    // priced correctly.
    model: "anthropic/claude-haiku-4-5",
    effectiveFrom: "2026-08-16",
    inputMicroUsdPerMTok: 1_000_000,
    outputMicroUsdPerMTok: 5_000_000,
  },
  {
    // **The same rates, with the cached-read price now on the record**
    // (M31 Phase 1). Read from the live catalogue on 2026-10-03: US regional
    // input $0.13, output $0.26 and `input_cache_read` $0.028 per MTok. The
    // first two are unchanged since 2026-08-16. A new dated entry rather than
    // an edit, so a month priced before today is still priced as it was.
    // `zai/glm-4.7-flash` lists no cached-read price, so it gets no entry.
    // The catalogue lists Haiku 4.5 under `anthropic/claude-haiku-4.5` at a
    // different US rate; re-pricing the compiled default is its own change.
    model: "deepseek/deepseek-v4-flash-0731",
    effectiveFrom: "2026-10-03",
    inputMicroUsdPerMTok: 130_000,
    outputMicroUsdPerMTok: 260_000,
    cacheReadInputMicroUsdPerMTok: 28_000,
  },
  {
    // **The turn model production runs** (`AI_MODEL_MID`, and `AI_MODEL_CHEAP`
    // since 2026-10-05) from its first live turn on 2026-10-03; until this
    // entry every one of its rows was unpriced in the cost console. Read from the live catalogue on
    // 2026-10-03: US regional input $0.15, output $0.50 and `input_cache_read`
    // $0.03 per MTok. The catalogue marks it `varies_by_provider`, and cache
    // hits do too — the first three live turns cached 0%, 0% and ~70% of input.
    model: "zai/glm-5.3-flash",
    effectiveFrom: "2026-10-03",
    inputMicroUsdPerMTok: 150_000,
    outputMicroUsdPerMTok: 500_000,
    cacheReadInputMicroUsdPerMTok: 30_000,
  },
  {
    // **The cheap tier production runs** (`AI_MODEL_CHEAP`), from its first live
    // turn on 2026-10-04; until this entry every cheap-tier row was unpriced
    // (found by M33, 2026-10-05). Read from the live catalogue on 2026-10-05:
    // input $0.06, output $0.40 and `input_cache_read` $0.01 per MTok.
    model: "zai/glm-4.7-flashx",
    effectiveFrom: "2026-10-04",
    inputMicroUsdPerMTok: 60_000,
    outputMicroUsdPerMTok: 400_000,
    cacheReadInputMicroUsdPerMTok: 10_000,
  },
  {
    // **The strong tier** (`AI_MODEL_STRONG`), from its first live turn on
    // 2026-09-19 (one turn; plan-class turns are rare). Unpriced until this
    // entry (M33, 2026-10-05). Read from the live catalogue on 2026-10-05: US
    // regional input $1.40, output $4.40 and `input_cache_read` $0.14 per MTok.
    // The catalogue marks it `varies_by_provider` and lists a `fast` route at
    // $2.10 / $6.60; the gateway's default route is the regional price.
    model: "zai/glm-5.3",
    effectiveFrom: "2026-09-19",
    inputMicroUsdPerMTok: 1_400_000,
    outputMicroUsdPerMTok: 4_400_000,
    cacheReadInputMicroUsdPerMTok: 140_000,
  },
];

// Frozen for the same reason the plan versions are: `readonly` is a
// compile-time promise, and a stray `sort()` over a list whose order is its
// publication history would be silent.
for (const rate of MODEL_RATES) Object.freeze(rate);
Object.freeze(MODEL_RATES);

/**
 * The rate in force for a model **as at a date** — the join, stated once.
 *
 * The newest entry whose `effectiveFrom` is on or before `at`. `null` when the
 * model is unknown or predates every published rate, and **null is not zero**:
 * a row nobody can price must not silently contribute nothing to a total, so
 * every caller decides what to do with it rather than being handed a lie.
 */
export function rateAt(
  model: string,
  at: Date,
  // **Injected, defaulting to the committed record**, for the reason
  // `consumeQuota` takes its counters: the interesting property of this
  // function is *which* entry it picks when a model has several, and the
  // committed file has exactly one per model today. Proving re-pricing against
  // it would mean inventing a rate change that never happened in a file whose
  // whole value is being a truthful append-only record. The test supplies its
  // own two-entry history instead.
  history: readonly ModelRate[] = MODEL_RATES,
): ModelRate | null {
  if (history !== MODEL_RATES) return scanRates(model, at, history);
  // **Remembered per model and UTC day, for the committed record only.** The
  // console prices every step of a 30-day window — 75k calls at 20k turns —
  // and the scan below was ~100 ms of that (M36 perf pass). The answer depends
  // only on the model and the date's day, and `MODEL_RATES` is frozen, so it
  // cannot go stale; an injected history always scans.
  const key = `${model}\u0000${Math.floor(at.getTime() / DAY_MS)}`;
  let rate = committedRateMemo.get(key);
  if (rate === undefined) {
    rate = scanRates(model, at, history);
    committedRateMemo.set(key, rate);
  }
  return rate;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const committedRateMemo = new Map<string, ModelRate | null>();

/** `rateAt`'s answer, worked out from the history. */
function scanRates(model: string, at: Date, history: readonly ModelRate[]): ModelRate | null {
  const asIso = at.toISOString().slice(0, 10);
  const candidates = history.filter(
    (rate) => rate.model === model && rate.effectiveFrom <= asIso,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, rate) => (rate.effectiveFrom > best.effectiveFrom ? rate : best));
}

/**
 * What a pair of token counts cost, in **micro-dollars**, at a date.
 *
 * Integer arithmetic throughout, rounded once at the end. `null` when the
 * model has no published rate, propagating the "unpriceable" answer rather
 * than inventing a zero.
 *
 * **No currency type crosses this boundary.** The return is a plain integer
 * count of micro-dollars; formatting it as a sum of money is a presentation
 * decision made where it is displayed, never here.
 */
export function microUsdFor(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
  at: Date,
  history: readonly ModelRate[] = MODEL_RATES,
  // How many of `tokensIn` were read from the prompt cache. `tokensIn` is the
  // AI SDK's TOTAL input, cached reads included, so these are a part of it
  // priced at the cached rate rather than an addition to it. Null — every
  // row written before M31 Phase 1 — prices all input as fresh, as before.
  cacheReadTokens: number | null = null,
  // How many of `tokensIn` were written to the prompt cache; also a part of
  // `tokensIn`, priced at the cache-write rate where one is on record.
  cacheWriteTokens: number | null = null,
): number | null {
  const rate = rateAt(model, at, history);
  // **`null` is unmeasured, and unmeasured is not free.** This read
  // `tokensIn ?? 0`, which is the exact defect the schema's own comment forbids
  // three files away — *"nullable token columns mean the provider reported no
  // usage, never zero. Zero is a measurement, and a rate join has to be able to
  // tell them apart."* Coercing here made `costPerAccount` report an unmeasured
  // request as costing nothing instead of counting it as `unpriced`, which is
  // the same "a number that understates and looks precise" failure the whole
  // no-`Money` rule exists to prevent. Found by CodeRabbit on PR #174.
  if (rate === null || tokensIn === null || tokensOut === null) return null;
  // Clamped to the total, so a provider reporting more cached than total
  // input cannot price the fresh part below zero.
  const cached = Math.min(Math.max(cacheReadTokens ?? 0, 0), tokensIn);
  const written = Math.min(Math.max(cacheWriteTokens ?? 0, 0), tokensIn - cached);
  const fresh = tokensIn - cached - written;
  const cachedRate = rate.cacheReadInputMicroUsdPerMTok ?? rate.inputMicroUsdPerMTok;
  const writtenRate = rate.cacheWriteInputMicroUsdPerMTok ?? rate.inputMicroUsdPerMTok;
  const input =
    (fresh * rate.inputMicroUsdPerMTok + cached * cachedRate + written * writtenRate) / 1_000_000;
  const output = (tokensOut * rate.outputMicroUsdPerMTok) / 1_000_000;
  return Math.round(input + output);
}
