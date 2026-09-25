import type { TimeFormat, UserPreferences } from "@tc/contracts";

// The ONE clock-time formatter, for the app and the notebook alike. Written in
// `apps/web/src/lib/time.ts` (M10 Phase 5), moved to `format.ts` here when the
// notebook's widgets had to print the board's clock (PR #221: Mitchell, *"All
// times should be in AM/PM not military time"*), and given its own file when
// the reader's clock became a setting. This package cannot import the app, and
// a second copy would be free to drift from the first; `@/lib/time`
// re-exports these, so the app's imports did not move.

/**
 * A stored `HH:mm` as something to read, in the reader's chosen clock.
 *
 * `"12h"` is the design's copy and every account's default: minutes dropped on
 * the hour ("10:30 am", "1 pm"), midnight and noon as 12. `"24h"` is the
 * opt-in the account settings offer (`UserPreferences.timeFormat`): always
 * zero-padded `HH:MM` ("00:00", "09:05", "14:30"), minutes kept on the hour,
 * because "14" alone is not a time and "9:00" beside "14:30" in a column
 * reads as a typo.
 *
 * The format is a REQUIRED argument, never defaulted: a default would let a
 * new call site print a 12-hour time at somebody who asked for 24 and
 * typecheck anyway. It is a property of the person reading, so it arrives from
 * their preferences — `useTimeFormat()` in a component, `readerClock(ctx.user)`
 * in a widget — or as `"12h"` with a stated reason where nobody is signed in.
 *
 * Storage stays 24-hour whatever this prints — string comparison is time
 * comparison, and every widget compares before it prints. Do not route an
 * editor's `<input type="time">` value through this, or it will stop
 * accepting input.
 *
 * Not `Intl.DateTimeFormat`, which needs a date and a zone to print a bare
 * wall-clock time and would emit "1:00 PM" rather than the house "1 pm".
 */
export function toClockLabel(time: string, format: TimeFormat): string {
  const [h, m] = time.split(":").map(Number);
  const hours24 = (h ?? 0) % 24;
  const mins = m ?? 0;
  if (format === "24h") return `${String(hours24).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return mins === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/**
 * A start–end pair as one label: "2:30 pm – 4 pm", or "14:30 – 16:00". Spaced,
 * because the meridiem ran into an unspaced dash (Mitchell, walking the #71
 * preview); the 24-hour form keeps the same spacing so the two read alike.
 */
export function toClockRange(start: string, end: string, format: TimeFormat): string {
  return `${toClockLabel(start, format)} – ${toClockLabel(end, format)}`;
}

/**
 * The clock a notebook widget prints in: the reader's, or the design's 12-hour
 * one when there is no reader account to ask — `WidgetContext.user` is `null`
 * for a signed-out reader and while the preferences read is in flight.
 */
export function readerClock(user: UserPreferences | null): TimeFormat {
  return user?.timeFormat ?? "12h";
}
