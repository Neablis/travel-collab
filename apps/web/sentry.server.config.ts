// Sentry on the Node server: every route handler, server action and RSC render.
// Loaded by `src/instrumentation.ts` when NEXT_RUNTIME is "nodejs".
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";
import { profileSessionSampleRate, sharedSentryOptions } from "./sentry.shared";

// **Server profiling needs a native module, and a native module can be absent.**
//
// `@sentry/profiling-node` ships prebuilt binaries for the platform/ABI matrix
// it supports and picks one at require time. That covers Vercel's Node runtime
// and this repo's Linux containers, but it is still a `.node` file resolved at
// runtime: a Node version newer than the newest prebuild, an unusual libc, or
// a bundler that failed to trace the binary all end the same way, with a throw
// from the import rather than a soft "profiling is off".
//
// This file is imported by `register()` and its throw would take the WHOLE
// server SDK down with it — no error reporting, no tracing, no metrics,
// because one optional feature could not load. So the import is dynamic and
// guarded, and a failure costs exactly the profiles. Top-level await is fine
// here: `instrumentation.ts` reaches this module through `await import(...)`.
//
// `next.config.ts` lists the package in `serverExternalPackages` so the
// bundler leaves it (and its binary) alone rather than trying to inline it.
//
// The return type is INFERRED rather than annotated `Integration[]`: the
// `Integration` type lives in `@sentry/core`, which is a transitive dependency
// here, and naming it would mean adding a direct dependency on Sentry's
// internals purely to spell a type this function already knows.
const nodeProfiling = await loadNodeProfiling();

async function loadNodeProfiling() {
  try {
    const { nodeProfilingIntegration } = await import("@sentry/profiling-node");
    return nodeProfilingIntegration();
  } catch (err) {
    // Deliberately `warn`, not `error`: the app is fine, one signal is
    // missing. Silence would be worse — "why are there no server profiles"
    // is otherwise an unanswerable question, and this line answers it.
    console.warn(
      "[sentry] server CPU profiling is unavailable (@sentry/profiling-node failed to load):",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

Sentry.init({
  ...sharedSentryOptions,

  // Merged WITH Sentry's defaults, not instead of them — which matters more
  // than it looks: `vercelAIIntegration()` is one of those defaults, and it is
  // the entire AI Agents feature (ADR-032). Setting `defaultIntegrations:
  // false` here would delete every gen_ai span in the app and nothing would go
  // red; `telemetry.int.test.ts` is the tripwire for that.
  integrations: [
    ...(nodeProfiling ? [nodeProfiling] : []),
    // Node/V8 runtime health — event-loop lag, heap, GC — as metrics rather
    // than as something to go read off a host. It is the other half of what a
    // profile tells you: the profile says which function is hot, this says
    // whether the process was starved while it ran.
    Sentry.nodeRuntimeMetricsIntegration(),
  ],

  // Continuous profiling, tied to tracing rather than run on a timer: the
  // profiler starts when a sampled root span opens and stops when the last one
  // closes. On a serverless function that is exactly the span of a request,
  // which is the only window worth profiling and the only one we are paying
  // for. `manual` would mean profiling an idle, frozen lambda.
  profileLifecycle: "trace",
  profileSessionSampleRate,

  dataCollection: {
    // **The one setting standing between Sentry and every prompt this app
    // sends.** The `VercelAI` integration below emits the AI SDK's spans, and
    // the AI SDK itself defaults `recordInputs`/`recordOutputs` to ON — it is
    // Sentry's own reader that currently defaults them off. That is a default
    // we do not control, on a value we care a lot about: `askAnalytics.ts`
    // decided, once and explicitly, that a user's question may go into OUR
    // structured log, and that decision does not extend to a third-party
    // service. Named here rather than left to the default so a flip upstream
    // cannot make it for us. `telemetry.int.test.ts` checks the bytes.
    genAI: { inputs: false, outputs: false },
  },
});
