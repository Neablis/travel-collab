// Sentry on the edge runtime (proxy.ts and any edge route). Loaded by
// `src/instrumentation.ts` when NEXT_RUNTIME is "edge". Note this is Next.js's
// own edge runtime, not Vercel's — it is needed locally too.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "./sentry.shared";

// No profiling here, and that is a property of the runtime rather than a
// choice: CPU profiling needs a native module the edge runtime cannot load,
// and there is no JS self-profiling API in it either. Errors, traces, logs and
// metrics all work.
Sentry.init({
  ...sharedSentryOptions,

  dataCollection: {
    // Same reasoning as the server config: stated, not defaulted, so an SDK
    // default-flip can't start sending model inputs on its own.
    genAI: { inputs: false, outputs: false },
  },
});
