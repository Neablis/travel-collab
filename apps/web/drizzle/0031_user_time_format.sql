-- `users.time_format` — whether this person reads clock times as 12-hour
-- ("2:30 pm") or 24-hour ("14:30"). Mitchell's ask: 12-hour stays the
-- default, 24-hour is a setting.
--
-- NOT NULL DEFAULT '12h', the same shape as `distance_unit` (0015): the
-- preference has no unset state, so every existing row reads as 12-hour — what
-- it rendered before the column existed.
ALTER TABLE "users" ADD COLUMN "time_format" text DEFAULT '12h' NOT NULL;
