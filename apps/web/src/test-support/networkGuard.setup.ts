// **Both test lanes' "no third party" setup, in one place.** The integration
// lane names this file in `vitest.config.ts`'s `setupFiles`; the unit lane's
// `vitest.setup.ts` imports it first, before its DOM shims. One file, so the
// two lanes cannot drift into guarding different things.
import { installNetworkGuard } from "./networkGuard";

// Any `fetch` to a host other than this machine rejects, naming the URL, and
// any socket connect to one (Node `http`/`https`, jsdom's XHR, `WebSocket`) is
// refused the same way. See `networkGuard.ts` for how it composes with MSW and
// what it does not cover.
installNetworkGuard();

// **Sentry off, forced — not `??=`.** Its node transport posts over `https`.
// The socket guard above would refuse that post, but Sentry would still
// attempt it and report the failure in the middle of someone else's test, so
// an empty DSN — Sentry never tries — stays the first line. And
// `sentry.shared.ts` falls back to the REAL production DSN when the variable
// is unset, so "unset" is not "off".
//
// `??=` was not enough, and measured so: `vitest.config.ts` loads `.env.local`
// with `process.loadEnvFile` BEFORE this runs, and that sets any variable the
// shell left unset — so a developer who uncomments the DSN line in
// `.env.local` would have handed this lane a live Sentry. The empty string is
// the SDK's documented no-op.
//
// Tests that exercise `sentry.shared.ts` are unaffected:
// `sentry.shared.test.ts` sets its own values per case with `vi.stubEnv`, and
// `ask/telemetry.int.test.ts` passes its own dummy DSN and in-memory transport
// straight to `Sentry.init`.
process.env.NEXT_PUBLIC_SENTRY_DSN = "";
