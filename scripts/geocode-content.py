#!/usr/bin/env python3
"""
Fill in `location.lat` / `location.lng` for every stop in `content/**/*.json`,
slowly, over as many sessions as it takes.

    python3 scripts/geocode-content.py --status          # what is left, no network
    python3 scripts/geocode-content.py                   # work the queue until done
    python3 scripts/geocode-content.py --max-requests 400
    python3 scripts/geocode-content.py --review          # what came back suspicious
    python3 scripts/geocode-content.py --apply           # write the good ones into the bundles

WHY THIS EXISTS
    The seeded content ships with no coordinates on purpose (KI-2026-09-06-c):
    the generators were told to omit them rather than invent them, because a
    confidently wrong pin is worse than no pin. This is the pass that fills them
    in from a real geocoder — and, just as importantly, REFUSES to fill in the
    ones it cannot stand behind.

WHY IT IS RESUMABLE RATHER THAN A ONE-SHOT
    ~1,300 distinct places at one request per second is over twenty minutes of
    continuous, rate-limited network for the free tiers, and in practice it is
    longer: providers 429, laptops sleep, keys hit a daily cap. So every answer
    is committed to SQLite the moment it arrives and nothing is held in memory
    between requests. Killing this script at any point loses at most the one
    request in flight; starting it again picks up exactly where it stopped.
    Running it twice in a row is a no-op the second time.

WHY PYTHON, IN A TYPESCRIPT REPO
    Mitchell asked for Python, and it is the right call for this one: it is a
    standalone operations tool that runs for hours or days OUTSIDE the build,
    shares no types with the app, and has no dependencies beyond the standard
    library — so it needs no install, no node_modules, and nothing in this repo
    breaks if it rots. Every other script under `scripts/` is `.mjs`/`.mts` and
    should stay that way; this is the exception, not a new convention.

THE ONE THING TO UNDERSTAND BEFORE TRUSTING IT
    A geocoder returning a result is not the same as a geocoder being right.
    `packages/fixtures/src/japan/coordinateOverrides.ts` records twelve
    disagreements from the Japan pass, SIX of them the geocoder confidently
    matching the WRONG VENUE INSIDE THE RIGHT CITY (KI-39). So every result goes
    through `judge()` below before it is allowed near a bundle, and anything it
    cannot vouch for is parked in the review file instead of being written.
    `--apply` never writes a result the judge did not clear.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sqlite3
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

REPO = Path(__file__).resolve().parent.parent
CONTENT = REPO / "content"
CACHE = CONTENT / ".geocode-cache.sqlite"
REVIEW = CONTENT / ".geocode-review.json"

# Statuses a queue row can hold. `failed` is retried on the next run; `ok`,
# `not_found` and `rejected` are terminal unless --retry-failed/--redo says
# otherwise, so a re-run does not spend requests re-asking settled questions.
RETRYABLE = ("pending", "failed")


# ---------------------------------------------------------------------------
# Stops and their queries
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Place:
    """One distinct place to look up, and the query built for it."""
    name: str
    area: str
    city: str

    @property
    def query(self) -> str:
        # `name, area, city` — the same shape `locationName()` builds for the
        # Japan fixture. The area is the half that disambiguates a venue name
        # that repeats across a city, which is exactly the KI-39 failure.
        return ", ".join(p for p in (self.name, self.area, self.city) if p)

    @property
    def key(self) -> str:
        return self.query.strip().lower()


def bundle_files() -> list[Path]:
    return sorted(p for p in CONTENT.rglob("*.json") if not p.name.startswith("."))


def stops_of(bundle: dict) -> Iterator[dict]:
    for pb in bundle.get("playbooks", []):
        yield from pb.get("stops", [])
    for trip in bundle.get("trips", []):
        for day in trip.get("days", []):
            yield from day.get("stops", [])
        yield from trip.get("backlog", [])
    yield from bundle.get("activities", [])


def places() -> dict[str, Place]:
    """Every distinct place across every bundle, keyed by its normalised query."""
    found: dict[str, Place] = {}
    for path in bundle_files():
        try:
            bundle = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"  ! {path.name} is not valid JSON ({exc}); skipped", file=sys.stderr)
            continue
        for stop in stops_of(bundle):
            loc = stop.get("location") or {}
            name = (loc.get("name") or "").strip()
            if not name:
                continue
            place = Place(name, (loc.get("area") or "").strip(), (loc.get("city") or "").strip())
            found.setdefault(place.key, place)
    return found


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------

def connect() -> sqlite3.Connection:
    CONTENT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(CACHE, timeout=30)
    # WAL so a reader (--status in another terminal) never blocks the worker,
    # and so an abrupt kill cannot leave a half-written page behind.
    db.execute("pragma journal_mode=wal")
    db.execute("pragma synchronous=full")
    db.execute(
        """
        create table if not exists places (
          key           text primary key,
          query         text not null,
          name          text not null,
          area          text not null,
          city          text not null,
          status        text not null default 'pending',
          lat           real,
          lng           real,
          display_name  text,
          country_code  text,
          result_city   text,
          provider      text,
          attempts      integer not null default 0,
          last_error    text,
          updated_at    text
        )
        """
    )
    return db


def sync_queue(db: sqlite3.Connection) -> tuple[int, int]:
    """Adds newly-seen places. Never deletes: a bundle edited between runs
    should not throw away answers already paid for."""
    found = places()
    before = db.execute("select count(*) from places").fetchone()[0]
    db.executemany(
        "insert or ignore into places (key, query, name, area, city) values (?,?,?,?,?)",
        [(p.key, p.query, p.name, p.area, p.city) for p in found.values()],
    )
    db.commit()
    after = db.execute("select count(*) from places").fetchone()[0]
    return after - before, len(found)


def counts(db: sqlite3.Connection) -> dict[str, int]:
    return {s: n for s, n in db.execute("select status, count(*) from places group by status")}


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

class RateLimited(Exception):
    def __init__(self, retry_after: float | None = None):
        super().__init__("rate limited")
        self.retry_after = retry_after


class Transient(Exception):
    pass


class KeyRing:
    """The API keys available, used ONE AT A TIME until each is spent.

    **Sequential failover, not round-robin, and the difference is the point.**
    Spreading requests across keys to exceed a provider's per-second rate limit
    is circumventing it; using your second key after the first has hit its DAILY
    cap is just using what you have. So this hands out one key, keeps using it,
    and only moves on when that key reports it is done for the day. The interval
    between requests never changes, whatever number of keys is loaded.

    Reads `LOCATIONIQ_API_KEY` and then `LOCATIONIQ_API_KEY_1`, `_2`, ... in
    order, so adding one is an env var and no code.

    For the record: at 1,344 places against LocationIQ's free tier (5,000/day,
    2/second) a SINGLE key finishes the whole queue in about eleven minutes with
    3,600 requests to spare. This exists for the day the content grows, or for
    somebody holding a personal key and a paid one — not because the job needs it.
    """

    def __init__(self, keys: list[str]):
        self.keys = [k for k in keys if k]
        self.i = 0
        self.spent: set[int] = set()
        self.used: dict[int, int] = {}

    def __bool__(self) -> bool:
        return bool(self.keys)

    @property
    def current(self) -> str | None:
        if not self.keys or len(self.spent) >= len(self.keys):
            return None
        while self.i in self.spent:
            self.i = (self.i + 1) % len(self.keys)
        return self.keys[self.i]

    def count(self) -> None:
        self.used[self.i] = self.used.get(self.i, 0) + 1

    def retire(self, why: str) -> bool:
        """This key is done for the day. Returns True if another is available."""
        self.spent.add(self.i)
        left = len(self.keys) - len(self.spent)
        print(f"  · key {self.i + 1}/{len(self.keys)} retired ({why}) — "
              f"{left} key(s) left", flush=True)
        if not left:
            return False
        self.i = (self.i + 1) % len(self.keys)
        return True

    def summary(self) -> str:
        if not self.keys:
            return "no key"
        parts = [f"key {i + 1}: {self.used.get(i, 0)}" for i in range(len(self.keys))]
        return " · ".join(parts)


class DailyCapReached(Exception):
    """The provider says this key is out of requests for the day."""


@dataclass
class Provider:
    name: str
    url: str
    keys: "KeyRing"
    min_interval: float
    user_agent: str

    @property
    def key(self) -> str | None:
        return self.keys.current

    def request_url(self, query: str) -> str:
        params = {
            "q": query,
            "format": "json",
            "addressdetails": "1",
            "limit": "1",
            # Romanised names, matching the app's own adapter: what this decides
            # is how a place is SPELLED IN STORAGE, not how one reader sees it.
            "accept-language": "en",
        }
        key = self.key
        if key:
            params["key"] = key
        return f"{self.url}?{urllib.parse.urlencode(params)}"

    def lookup(self, query: str) -> dict | None:
        req = urllib.request.Request(
            self.request_url(query),
            headers={"Accept": "application/json", "User-Agent": self.user_agent},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                rows = json.loads(res.read().decode("utf-8"))
            self.keys.count()
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                # LocationIQ answers 429 for BOTH "too fast" and "out for the
                # day", and they need opposite responses: back off, or switch
                # keys. The body is what tells them apart — "Rate Limited Second"
                # versus a daily/minute quota message.
                body = ""
                try:
                    body = exc.read().decode("utf-8", "replace")[:300].lower()
                except Exception:
                    pass
                if "day" in body or "quota" in body or "exceeded your daily" in body:
                    raise DailyCapReached(body.strip() or "daily quota")
                retry_after = exc.headers.get("Retry-After")
                raise RateLimited(float(retry_after) if retry_after and retry_after.isdigit() else None)
            if exc.code == 404:
                return None
            # 401/403 are a bad key and will not fix themselves — fail loudly
            # rather than burning the whole queue against a wall.
            if exc.code in (401, 403):
                raise SystemExit(f"provider refused the key ({exc.code}). Check the API key and try again.")
            if 500 <= exc.code < 600:
                raise Transient(f"http {exc.code}")
            raise Transient(f"http {exc.code}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            raise Transient(str(exc))
        if isinstance(rows, dict) and rows.get("error"):
            # LocationIQ says "Unable to geocode" as a 200 with an error body.
            return None
        if not rows:
            return None
        return rows[0]


def api_keys(args) -> KeyRing:
    """`--key`, then LOCATIONIQ_API_KEY, then LOCATIONIQ_API_KEY_1, _2, ... ."""
    keys: list[str] = []
    if args.key:
        keys.append(args.key.strip())
    for name in ["LOCATIONIQ_API_KEY"] + [f"LOCATIONIQ_API_KEY_{n}" for n in range(1, 10)]:
        value = (os.environ.get(name) or "").strip()
        if value and value not in keys:
            keys.append(value)
    return KeyRing(keys)


def build_provider(args) -> Provider:
    ring = api_keys(args)
    if args.url:
        # A self-hosted Nominatim, which is the honest answer for 1,300+ places:
        # no rate limit you have to respect out of courtesy, no daily cap, and
        # the whole queue finishes in minutes rather than days. Also what the
        # test harness points at.
        return Provider(
            name="custom",
            url=args.url,
            keys=ring,
            min_interval=args.interval if args.interval is not None else 0.0,
            user_agent="travel-collab-content-geocoder/1.0",
        )
    if ring:
        return Provider(
            name=f"locationiq ({len(ring.keys)} key{'s' if len(ring.keys) > 1 else ''})",
            url="https://us1.locationiq.com/v1/search",
            keys=ring,
            # The free tier is 2 requests/second and 5,000/day. One per second
            # leaves headroom and is what the Japan pass used.
            min_interval=args.interval if args.interval is not None else 1.0,
            user_agent="travel-collab-geocode/1.0",
        )
    return Provider(
        name="nominatim",
        url="https://nominatim.openstreetmap.org/search",
        keys=ring,
        # Nominatim's usage policy is an ABSOLUTE maximum of 1 request/second
        # and a real User-Agent identifying the application. Going faster gets
        # the IP blocked, not throttled. Do not lower this.
        min_interval=args.interval if args.interval is not None else 1.1,
        user_agent="travel-collab-content-geocoder/1.0 (+https://github.com/Neablis/travel-collab)",
    )


# ---------------------------------------------------------------------------
# The judge — what we are willing to write
# ---------------------------------------------------------------------------

SETTLEMENT_KEYS = ("city", "town", "village", "hamlet", "municipality", "county", "state")


def judge(place: Place, row: dict) -> tuple[bool, str]:
    """Whether a result is good enough to write. Returns (accept, reason).

    KI-39 is the whole reason this exists: the Japan pass produced six results
    that were the wrong VENUE inside the right CITY, and nothing caught them
    until a person compared pins to places by hand. A geocoder is confident
    about everything, so confidence is not a signal — agreement is.
    """
    try:
        lat, lng = float(row["lat"]), float(row["lon"])
    except (KeyError, TypeError, ValueError):
        return False, "no usable lat/lon in the result"
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return False, f"coordinates out of range ({lat}, {lng})"

    display = (row.get("display_name") or "").lower()
    address = row.get("address") or {}

    # The city test. A stop's `city` is the field Discover matches on and the
    # one thing about a place we are certain of, so a result that landed in a
    # different city is wrong however plausible it looks.
    if place.city:
        wanted = place.city.lower()
        returned = [str(address.get(k, "")).lower() for k in SETTLEMENT_KEYS]
        if wanted not in display and not any(wanted == r or wanted in r for r in returned if r):
            return False, f"result is not in {place.city} (got: {row.get('display_name', '?')[:90]})"

    return True, "ok"


def flag_outliers(db: sqlite3.Connection, km: float = 60.0) -> list[tuple[str, str, float]]:
    """Accepted results that sit absurdly far from the rest of their own city.

    The city test above catches a result in the wrong city. This catches the
    other half — a result the provider labelled with the right city that is
    nowhere near the others carrying that label, which is what a wrong-venue
    match looks like when the venue happens to share a name with somewhere in
    the suburbs. Reported, never auto-rejected: a genuinely remote trailhead
    outside a small town is a real place and this would flag it too.
    """
    rows = db.execute(
        "select key, query, city, lat, lng from places where status='ok' and city != ''"
    ).fetchall()
    by_city: dict[str, list] = {}
    for key, query, city, lat, lng in rows:
        by_city.setdefault(city, []).append((key, query, lat, lng))

    out = []
    for city, entries in by_city.items():
        if len(entries) < 3:
            continue  # a median of two says nothing
        mlat = statistics.median(e[2] for e in entries)
        mlng = statistics.median(e[3] for e in entries)
        for key, query, lat, lng in entries:
            # Equirectangular approximation — plenty for "is this tens of km out".
            dx = (lng - mlng) * 111.32 * max(0.01, abs(1 - abs(mlat) / 90))
            dy = (lat - mlat) * 110.57
            dist = (dx * dx + dy * dy) ** 0.5
            if dist > km:
                out.append((query, city, round(dist, 1)))
    return sorted(out, key=lambda r: -r[2])


# ---------------------------------------------------------------------------
# The run loop
# ---------------------------------------------------------------------------

class Progress:
    """A live status line, so a long run never looks hung.

    **On a terminal this rewrites ONE line on every single request**, naming the
    place currently in flight — because the silence between updates is the thing
    that makes somebody kill a working job. At Nominatim's courteous 1.1s that
    silence was 27 seconds with the old every-25-requests reporting, which is
    well past the point where a reasonable person assumes it has hung.

    **Piped to a file it degrades to periodic newlines instead**, because a log
    full of carriage returns is unreadable and `tail -f` on it is worse. So
    `python3 scripts/geocode-content.py | tee run.log` still produces something
    you can read afterwards.
    """

    def __init__(self, total_run: int, outstanding: int, grand: int, every: int):
        self.total_run = total_run
        self.outstanding = outstanding
        self.grand = grand
        self.every = max(1, every)
        self.started = time.monotonic()
        self.tty = sys.stdout.isatty()
        self.width = 0

    def line(self, done_all: int, processed: int, label: str) -> str:
        head = (f"  {done_all}/{self.grand} settled · "
                f"{processed}/{self.total_run} this run")
        # A rate computed from one or two samples is nonsense — the first tick
        # divides by a near-zero elapsed and claims thousands per minute, which
        # reads as a bug rather than as a warm-up. Say nothing until the average
        # means something.
        elapsed = time.monotonic() - self.started
        if processed >= 3 and elapsed > 0:
            rate = processed / elapsed
            eta = max(self.outstanding - processed, 0) / rate
            eta_s = f"{eta / 60:.0f}m" if eta < 5400 else f"{eta / 3600:.1f}h"
            head += f" · {rate * 60:.0f}/min · ~{eta_s} left"
        return f"{head} · {label}"

    def tick(self, done_all: int, processed: int, label: str) -> None:
        text = self.line(done_all, processed, label)
        if self.tty:
            # Pad to erase the previous, longer line rather than leaving its tail
            # behind — a half-overwritten place name reads as corruption.
            padded = text[:150].ljust(self.width)
            self.width = max(len(text[:150]), 0)
            sys.stdout.write("\r" + padded)
            sys.stdout.flush()
        elif processed % self.every == 0 or processed == self.total_run:
            print(text, flush=True)

    def interrupt(self, message: str) -> None:
        """Print something that must survive, without the status line eating it."""
        if self.tty:
            sys.stdout.write("\r" + " " * self.width + "\r")
            self.width = 0
        print(message, flush=True)

    def done(self) -> None:
        if self.tty and self.width:
            sys.stdout.write("\n")
            sys.stdout.flush()
            self.width = 0


class Stopping:
    """SIGINT/SIGTERM sets a flag; the loop finishes its current write and exits.

    Not `sys.exit` from the handler: that can land between the network call and
    the commit, which is the one moment where a kill costs a request that was
    already paid for.
    """

    def __init__(self):
        self.now = False
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, self._handle)

    def _handle(self, *_):
        if self.now:  # a second Ctrl-C means they mean it
            raise KeyboardInterrupt
        self.now = True
        print("\n  stopping after this request — press Ctrl-C again to abandon it", flush=True)


def work(db: sqlite3.Connection, provider: Provider, args) -> None:
    stopping = Stopping()
    todo = db.execute(
        f"select key, query, name, area, city, attempts from places "
        f"where status in ({','.join('?' * len(RETRYABLE))}) "
        f"and attempts < ? order by attempts, key",
        (*RETRYABLE, args.max_attempts),
    ).fetchall()

    total_remaining = len(todo)
    if args.max_requests:
        todo = todo[: args.max_requests]
    if not todo:
        print("  nothing to do — every place is settled. `--review` to see what needs eyes.")
        return

    done_all = db.execute("select count(*) from places where status not in ('pending','failed')").fetchone()[0]
    grand = db.execute("select count(*) from places").fetchone()[0]
    print(f"  provider {provider.name} at {provider.min_interval:.2f}s between requests")
    if len(provider.keys.keys) > 1:
        print("  keys are used one at a time, in order — a second key is a second DAY's "
              "quota, never a faster rate")
    print(f"  {len(todo)} this run · {total_remaining} outstanding · {grand} places total\n")

    progress = Progress(len(todo), total_remaining, grand, args.progress_every)
    backoff = provider.min_interval
    processed = 0

    for key, query, name, area, city, attempts in todo:
        if stopping.now:
            break
        place = Place(name, area, city)
        status, lat, lng, display, cc, rcity, err = "failed", None, None, None, None, None, None
        try:
            row = provider.lookup(query)
            backoff = provider.min_interval  # a success clears the penalty box
            if row is None:
                status, err = "not_found", "no result"
            else:
                accept, reason = judge(place, row)
                display = row.get("display_name")
                address = row.get("address") or {}
                cc = (address.get("country_code") or "").upper() or None
                rcity = next((address[k] for k in SETTLEMENT_KEYS if address.get(k)), None)
                if accept:
                    status, lat, lng = "ok", float(row["lat"]), float(row["lon"])
                else:
                    status, err = "rejected", reason
        except DailyCapReached as exc:
            # Not a backoff: waiting will not help until midnight. Move to the
            # next key if there is one, and otherwise stop cleanly so the next
            # run picks up here tomorrow.
            progress.done()
            if not provider.keys.retire(str(exc)[:60]):
                print("  every key is out of requests for the day. "
                      "Re-run tomorrow — the queue resumes where it stopped.")
                break
            continue
        except RateLimited as exc:
            wait = exc.retry_after or min(backoff * 2, args.max_backoff)
            backoff = min(max(wait, provider.min_interval * 2), args.max_backoff)
            progress.interrupt(f"  · rate limited — sleeping {wait:.0f}s ({query[:50]})")
            db.execute(
                "update places set attempts=attempts+1, last_error=?, updated_at=? where key=?",
                ("rate limited", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), key),
            )
            db.commit()
            # Sleep in slices so Ctrl-C during a long backoff still stops promptly.
            slept = 0.0
            while slept < wait and not stopping.now:
                time.sleep(min(1.0, wait - slept))
                slept += 1.0
            continue
        except Transient as exc:
            status, err = "failed", str(exc)[:200]
            backoff = min(backoff * 2, args.max_backoff)

        db.execute(
            """update places set status=?, lat=?, lng=?, display_name=?, country_code=?,
                                 result_city=?, provider=?, attempts=attempts+1,
                                 last_error=?, updated_at=? where key=?""",
            (status, lat, lng, display, cc, rcity, provider.name, err,
             time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), key),
        )
        db.commit()  # after EVERY row: this is what makes a kill -9 cheap

        processed += 1
        done_all += 1 if status != "failed" else 0
        # Every request, not every 25th: see `Progress`. The label is the place
        # that just resolved, so the line moves visibly even when the counters
        # do not.
        progress.tick(done_all, processed, f"{status:9s} {query[:52]}")

        # Jitter, so a restarted run does not march in lockstep with whatever
        # else is hitting the same endpoint.
        time.sleep(backoff + random.uniform(0, 0.25))

    progress.done()
    if len(provider.keys.keys) > 1:
        print(f"  requests per key — {provider.keys.summary()}")
    print()
    report(db)


# ---------------------------------------------------------------------------
# Reporting and applying
# ---------------------------------------------------------------------------

def report(db: sqlite3.Connection) -> None:
    c = counts(db)
    grand = sum(c.values())
    order = ["ok", "rejected", "not_found", "failed", "pending"]
    for status in order:
        if c.get(status):
            print(f"  {status:10s} {c[status]:5d}")
    for status, n in c.items():
        if status not in order:
            print(f"  {status:10s} {n:5d}")
    settled = sum(v for k, v in c.items() if k not in ("pending", "failed"))
    print(f"  {'—' * 16}\n  {settled}/{grand} settled")
    stuck = db.execute(
        "select count(*) from places where status='failed' and attempts >= 3"
    ).fetchone()[0]
    if stuck:
        print(f"  {stuck} have failed 3+ times — `--retry-failed` resets them, or look at --review")


def write_review(db: sqlite3.Connection) -> dict:
    rejected = db.execute(
        "select query, city, display_name, last_error from places where status='rejected' order by city, query"
    ).fetchall()
    missing = db.execute(
        "select query, city, last_error from places where status in ('not_found','failed') order by city, query"
    ).fetchall()
    outliers = flag_outliers(db)
    review = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": (
            "Everything here is a place this pass would NOT write a coordinate for, plus "
            "accepted results that sit far from their own city's median. Fix by correcting "
            "location.name/area/city in the bundle and re-running, or leave it — a stop with "
            "no coordinate is a real state and better than a wrong pin (KI-39)."
        ),
        "rejected": [
            {"query": q, "city": c, "got": d, "why": e} for q, c, d, e in rejected
        ],
        "unresolved": [{"query": q, "city": c, "why": e} for q, c, e in missing],
        "farFromCityMedian": [
            {"query": q, "city": c, "kmFromMedian": d} for q, c, d in outliers
        ],
    }
    REVIEW.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return review


def apply(db: sqlite3.Connection, dry_run: bool) -> None:
    """Writes accepted coordinates into the bundles. Never writes a rejected one."""
    good = {
        key: (lat, lng)
        for key, lat, lng in db.execute(
            "select key, lat, lng from places where status='ok' and lat is not null"
        )
    }
    outlier_keys = {q.strip().lower() for q, _, _ in flag_outliers(db)}
    if outlier_keys:
        print(f"  holding back {len(outlier_keys)} outlier(s) — see --review")

    touched = written = held = 0
    for path in bundle_files():
        bundle = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for stop in stops_of(bundle):
            loc = stop.get("location") or {}
            name = (loc.get("name") or "").strip()
            if not name or "lat" in loc:
                continue
            place = Place(name, (loc.get("area") or "").strip(), (loc.get("city") or "").strip())
            if place.key in outlier_keys:
                held += 1
                continue
            hit = good.get(place.key)
            if not hit:
                continue
            # Insert lat/lng together — `Location` refines that they are
            # provided as a pair, so writing one without the other makes the
            # bundle unparseable.
            loc["lat"], loc["lng"] = round(hit[0], 6), round(hit[1], 6)
            stop["location"] = loc
            written += 1
            changed = True
        if changed:
            touched += 1
            if not dry_run:
                path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    verb = "would write" if dry_run else "wrote"
    print(f"  {verb} {written} coordinate(s) across {touched} bundle(s); {held} held back for review")
    if not dry_run and written:
        print("  now run `pnpm content:verify` — the schema refuses a lat without a lng.")


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", action="store_true", help="print progress and exit; touches no network")
    ap.add_argument("--review", action="store_true", help="write and summarise the review file")
    ap.add_argument("--apply", action="store_true", help="write accepted coordinates into the bundles")
    ap.add_argument("--dry-run", action="store_true", help="with --apply, report without writing")
    ap.add_argument("--retry-failed", action="store_true", help="reset failed rows so the next run retries them")
    ap.add_argument("--redo", action="store_true", help="reset EVERYTHING, including answers already paid for")
    ap.add_argument("--key", help="a LocationIQ key; also reads $LOCATIONIQ_API_KEY and "
                                  "$LOCATIONIQ_API_KEY_1..9, used one at a time as each "
                                  "hits its daily cap")
    ap.add_argument("--url", help="search endpoint to use instead (e.g. a self-hosted Nominatim)")
    ap.add_argument("--interval", type=float, help="seconds between requests (default: per provider)")
    ap.add_argument("--max-requests", type=int, help="stop after this many lookups this run")
    ap.add_argument("--max-attempts", type=int, default=4, help="give up on a place after this many tries")
    ap.add_argument("--max-backoff", type=float, default=300.0, help="longest sleep after a 429")
    ap.add_argument("--progress-every", type=int, default=10,
                    help="when output is piped to a file, print a line every N lookups "
                         "(on a terminal the status line updates every request regardless)")
    args = ap.parse_args()

    db = connect()
    if args.redo:
        db.execute("update places set status='pending', attempts=0, last_error=null")
        db.commit()
        print("  reset every place to pending")
    if args.retry_failed:
        n = db.execute("update places set status='pending', attempts=0 where status='failed'").rowcount
        db.commit()
        print(f"  reset {n} failed place(s) to pending")

    added, seen = sync_queue(db)
    print(f"  {seen} distinct places across {len(bundle_files())} bundle(s)" + (f" (+{added} new)" if added else ""))

    if args.status:
        report(db)
        return
    if args.review:
        review = write_review(db)
        print(f"  {len(review['rejected'])} rejected · {len(review['unresolved'])} unresolved · "
              f"{len(review['farFromCityMedian'])} far from their city")
        print(f"  written to {REVIEW.relative_to(REPO)}")
        return
    if args.apply:
        apply(db, args.dry_run)
        return

    work(db, build_provider(args), args)
    write_review(db)
    print(f"  review written to {REVIEW.relative_to(REPO)}")


if __name__ == "__main__":
    main()
