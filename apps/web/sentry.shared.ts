// The options every Sentry runtime shares — browser, Node server, and edge.
//
// The wizard wrote three `Sentry.init` calls with the DSN and the sample rates
// copy-pasted into each. That is three places to edit and two places to forget:
// the DSN literal alone appeared three times, so a project rename would have
// left whichever file nobody grepped pointing at the old one. Everything that
// is genuinely the same in all three lives here; each runtime file adds only
// what is specific to it (Replay and browser profiling on the client, the CPU
// profiler on the server).
//
// **Nothing here is a secret.** A Sentry DSN is a public write-only ingest key
// and ships in the client bundle by design — `NEXT_PUBLIC_SENTRY_DSN` is
// public for that reason. The token that CAN do damage is
// `SENTRY_AUTH_TOKEN` (source-map upload at build time); it is read by
// `withSentryConfig` in next.config.ts, never by this file, and never reaches
// a bundle.

/**
 * Where events go.
 *
 * The literal is the fallback rather than the only value, so a fork, a second
 * Sentry project, or a local run that wants telemetry to go nowhere is one
 * environment variable away instead of a code edit. Set it to the empty string
 * to disable Sentry entirely: `Sentry.init({ dsn: "" })` is the SDK's own
 * documented no-op, and it is what `sentryEnabled` below reports on.
 */
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://305df166f51c7bdec326b199cd9dca9c@o4511998018125824.ingest.us.sentry.io/4511998020616192";

/**
 * Which deployment an event came from.
 *
 * `VERCEL_ENV` ("production" | "preview" | "development") is set by Vercel and
 * is the distinction that matters for triage: a preview error is a reviewer
 * hitting a branch, a production error is a user. Locally it is unset and
 * `NODE_ENV` answers instead — which is why this is not just `VERCEL_ENV`.
 */
export const SENTRY_ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Which build an event came from, so a stack trace resolves against the right
 * source maps.
 *
 * `withSentryConfig` uploads source maps under a release it derives from the
 * same commit SHA, so naming it here is what associates the two. Undefined
 * locally (no git SHA in the environment), which is correct: a local build has
 * no uploaded source maps to associate with.
 */
export const SENTRY_RELEASE =
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined;

/** False when the DSN was deliberately blanked — see `SENTRY_DSN`. */
export const sentryEnabled = SENTRY_DSN !== "";

/**
 * Read a 0-to-1 sample rate from the environment, falling back to `fallback`.
 *
 * Deliberately strict about what counts as a valid rate: a typo
 * (`"0,1"`, `"10%"`, `"true"`) must not silently become `NaN`, because
 * `Math.random() < NaN` is always false — a mistyped rate would turn the
 * feature OFF while looking like it had been turned up. Out-of-range numbers
 * are rejected for the same reason (a `2` reads as "extra on" and means
 * nothing to the SDK).
 */
export function sampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

/**
 * How much of the traffic gets a trace.
 *
 * 1.0, unchanged from what the wizard wrote, and load-bearing rather than
 * lazy: the AI agent spans (`aiTelemetry.ts`) and the Sentry AI Agents
 * dashboard built on them are only as complete as the sampling underneath
 * them, and this app's traffic is a handful of turns a day. Turn it down
 * through `SENTRY_TRACES_SAMPLE_RATE` if that ever stops being true — the
 * variable exists so that is a deployment change, not a deploy.
 */
export const tracesSampleRate = sampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 1);

/**
 * How many user/server sessions get a CPU profile.
 *
 * Paired with `profileLifecycle: "trace"` everywhere it is used, which is the
 * cheap half of the deal: the profiler only runs while a SAMPLED root span is
 * open, so a session that is sampled here still profiles nothing until a real
 * request or page load is in flight. The two together are why 1.0 is
 * affordable at this traffic level.
 */
export const profileSessionSampleRate = sampleRate(process.env.SENTRY_PROFILE_SESSION_SAMPLE_RATE, 1);

/**
 * The options shared by all three runtimes.
 *
 * `enableLogs` and `enableMetrics` are the two that are not defaults:
 *
 *   * **Logs** were already being written — the wizard's example route calls
 *     `Sentry.logger.info`, which without this option is a silent no-op. It is
 *     on so that call, and any deliberate one after it, actually arrives.
 *   * **Metrics** are what `aiMetrics.ts` writes token usage and tool-call
 *     counts to. `Sentry.metrics.*` is likewise a silent no-op without it, so
 *     this option is the difference between the AI cost dashboard having
 *     numbers and having nothing, with no error either way to tell you which.
 */
export const sharedSentryOptions = {
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,
  tracesSampleRate,
  enableLogs: true,
  enableMetrics: true,
  // Off, and stated rather than left to the default. This app's spans and
  // logs carry trip questions and user ids that we choose field by field
  // (askAnalytics.ts weighs that choice at length); letting the SDK
  // additionally attach IP addresses, cookies and request bodies by default
  // would put PII into Sentry that nobody decided to send.
  sendDefaultPii: false,
} as const;
