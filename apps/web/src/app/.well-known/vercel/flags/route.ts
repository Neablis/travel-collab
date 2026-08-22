// Flags Explorer discovery endpoint. Exposes this app's flag definitions to
// the Vercel Toolbar so a flag can be inspected and OVERRIDDEN PER SESSION on
// a preview deployment — which is how a reviewer turns on live AI for
// themselves without changing the value for everyone else.
//
// Authenticated by FLAGS_SECRET (createFlagsDiscoveryEndpoint verifies it).
// With the secret unset, a bare unauthenticated probe 401s, which is the
// correct local-dev behavior — there is no toolbar to serve. A request that
// DOES carry an Authorization header but finds no configured FLAGS_SECRET
// throws inside verifyAccess and 500s instead — still fine locally, just not
// a 401.
//
// The path is fixed by the Flags Explorer and is NOT under src/app/api, so
// eslint.config.mjs carries an explicit exemption for
// src/app/.well-known/**/route.ts (route handlers only, not the whole
// directory) to let this file import @/server/*. See the comment there.
import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import * as flags from "@/server/flags";

export const GET = createFlagsDiscoveryEndpoint(async () => getProviderData(flags));
