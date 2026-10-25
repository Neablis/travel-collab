import { z } from "zod";

// **An ISO 8601 instant, accepted exactly as zod 3's `z.string().datetime()`
// accepted it.** zod 4's `.datetime()` is narrower in two ways no stored row or
// outside source was ever checked against: it requires the seconds
// (`2026-10-25T10:00Z` was valid) and, with `offset`, the colon in the offset
// (`+0200` was valid). A value written yesterday must still parse today, so the
// zod 3 grammar is kept here, copied from its `datetimeRegex`: a calendar date
// (leap years checked), `T`, `HH:MM` with optional `:SS` and fraction, then `Z`
// — or, with `offset`, `±HH:MM` or `±HHMM`.
//
// It publishes as `format: "date-time"`, as the zod 3 schema did, and refuses
// with zod 3's message.
const DATE =
  "((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))";
const TIME = "([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?";
const UTC_ONLY = new RegExp(`^${DATE}T${TIME}(Z)$`);
const WITH_OFFSET = new RegExp(`^${DATE}T${TIME}(Z|([+-]\\d{2}:?\\d{2}))$`);

/** A `Z` instant, or with `offset: true` also one carrying `±HH:MM`/`±HHMM`. */
export function isoDateTime(options: { offset?: boolean } = {}) {
  const grammar = options.offset === true ? WITH_OFFSET : UTC_ONLY;
  return z
    .string()
    .refine((value) => grammar.test(value), { message: "Invalid datetime" })
    .meta({ format: "date-time" });
}
