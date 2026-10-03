### KI-2026-10-03-f — accepting a day add/remove before an earlier range edit changes that edit's outcome

- **Severity:** correctness, quiet. Nothing fails. The trip ends up valid but
  not as the suggester drafted it.
- **Area:** `apps/web/src/server/suggestions/dependencies.ts` (the range-edit
  rule, spec W56); `apps/web/src/server/suggestions/resolve.ts` (accept).

- **Symptom:** a draft has a date-range edit (`SetTripDates` with an end date),
  followed by a later `AddDay` or `RemoveDay`. A reviewer accepts the later
  change first, then the range edit. The range edit still applies, but it now
  starts from a different day count. So it consumes a different number of new
  day ids, or drops different days, than the dry run showed when the
  suggestion was created.
- **Cause:** W56 makes a range edit depend on *earlier* units that changed the
  day count. It does not make a later day-count change depend on an earlier
  range edit, because the later change still applies on its own and nothing
  fails.
- **Why it is left:** making every later day-count change depend on every
  earlier range edit would block independent changes behind one another. The
  narrower rule was chosen on purpose (W56). A fix belongs with a decision on
  whether accept order should be free or should follow draft order for
  trip-shape changes.
