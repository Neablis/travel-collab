import type { z } from "zod";

// KI-2026-09-05-q / F-E04. The access half of a route's preamble has one seam
// (`requireTripAccess`); body reading had none, and five routes awaited
// `request.json()` bare. That call REJECTS on a body that is not JSON, so the
// rejection escaped the handler and Next answered 500 — a client error filed
// in Sentry as a server fault — while the same routes answered 400 to JSON the
// schema refused. This is the one place both failures become the same 400.
//
// The result has the `"error" in x` shape `requireTripAccess` returns, so a
// route's preamble reads as two identical steps:
//
//   const g = await guard(tripId, "editor");
//   if ("error" in g) return g.error;
//   const body = await readBody(req, CreatePageInput, "invalid-page");
//   if ("error" in body) return body.error;
//
// Not used by `/ask`: that pipeline caps the body on BYTES before parsing it
// (`capRawBody` in `server/assistant/admission.ts`), which `request.json()`
// cannot do, and its 400 names the rule broken. Not used by `/api/v1`, which
// answers in its own error envelope (`server/public-api`).

// A sentinel rather than `null`: `null` is valid JSON, and a schema that
// accepts it must still be handed it.
const INVALID_JSON = Symbol("invalid-json");

/** A body read that failed (already a 400), or the parsed body. */
export type ReadBodyResult<T> = { error: Response } | { data: T };

/**
 * The request's JSON body parsed against `schema`. A body that is not JSON and
 * a body the schema refuses both come back as a 400 carrying `invalid` as its
 * `error` — never as a rejected promise, which is what a route turns into a 500.
 */
export async function readBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  invalid = "malformed request",
): Promise<ReadBodyResult<z.infer<Schema>>> {
  const raw: unknown = await request.json().catch(() => INVALID_JSON);
  const parsed = raw === INVALID_JSON ? null : schema.safeParse(raw);
  if (!parsed?.success) return { error: Response.json({ error: invalid }, { status: 400 }) };
  return { data: parsed.data as z.infer<Schema> };
}
