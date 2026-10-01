-- The link-preview sweep (`sweepExpiredCounters`, PR #259) deletes ended
-- `link-preview-minute:` rows; with only the `bucket` primary key it seq-scanned
-- the whole table. Partial and window-led, so it holds only IP-keyed rows and a
-- sweep reads what it deletes. Plain CREATE INDEX: drizzle migrates in a
-- transaction, and the table is small, so the lock is brief.
CREATE INDEX "rate_limit_counters_link_preview_window" ON "rate_limit_counters" USING btree ("window_start") WHERE starts_with("rate_limit_counters"."bucket", 'link-preview-minute:');
