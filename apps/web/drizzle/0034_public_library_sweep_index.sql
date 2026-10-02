-- The public-library sweep (`publicLibraryQuota`, ADR-061) deletes ended
-- `public-library-minute:` rows, which are keyed by IP like link previews'.
-- Same shape as 0033: partial and window-led, so a sweep reads what it deletes
-- and account rows are not in it. KI-2026-10-02-a.
CREATE INDEX "rate_limit_counters_public_library_window" ON "rate_limit_counters" USING btree ("window_start") WHERE starts_with("rate_limit_counters"."bucket", 'public-library-minute:');