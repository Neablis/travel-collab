-- KI-2026-10-05-d: Discover matched a city by its exact spelling. `cities_folded`
-- is every city's match key, generated from `cities`, so no writer can forget it
-- and this statement backfills every existing row (a one-time table rewrite).
--
-- `tc_city_key` is `slugify` (apps/web/src/lib/playbookUrls.ts) step for step, in
-- SQL, or the city itself when its slug is empty: `cityKey` in the same file.
-- `cityKey.int.test.ts` holds the two equal over every BMP character (measured
-- over every code point: equal but for U+1CCF0-1CCF9, digits Unicode 16 added
-- after this server's tables). `lower` runs under the ICU root collation, never
-- the database's: JS `toLowerCase` is Unicode's default case mapping, which is
-- what ICU root applies, and a libc or "C" locale would fold differently (or
-- ASCII alone). With the locale out of it, the function is IMMUTABLE as any
-- normalized or ICU index is: until the server's Unicode or ICU version moves.
-- Schema-qualified so a restore with an empty search_path still finds it.
-- Every statement is re-runnable (OR REPLACE, IF NOT EXISTS), and the fill is a
-- pure function of `cities`, so a re-run changes nothing.
CREATE OR REPLACE FUNCTION public.tc_city_key(city text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT CASE WHEN folded.slug = '' THEN city ELSE folded.slug END
  FROM (
    SELECT regexp_replace(
      left(
        regexp_replace(
          regexp_replace(
            replace(replace(replace(replace(replace(
              translate(
                regexp_replace(normalize(lower(city COLLATE "und-x-icu"), NFKD), '[\u0300-\u036f]', '', 'g'),
                'łøđðıħŧ',
                'loddiht'
              ),
              'ß', 'ss'), 'þ', 'th'), 'æ', 'ae'), 'œ', 'oe'), 'ŋ', 'ng'),
            '[^a-z0-9]+', '-', 'g'
          ),
          '^-+|-+$', '', 'g'
        ),
        60
      ),
      '-+$', ''
    ) AS slug
  ) AS folded
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tc_city_keys(cities text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT coalesce(array_agg(DISTINCT public.tc_city_key(city)), '{}'::text[])
  FROM unnest(cities) AS city
$$;
--> statement-breakpoint
ALTER TABLE "saved_days" ADD COLUMN IF NOT EXISTS "cities_folded" text[] GENERATED ALWAYS AS (public.tc_city_keys("cities")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_days_cities_folded" ON "saved_days" USING gin ("cities_folded");
