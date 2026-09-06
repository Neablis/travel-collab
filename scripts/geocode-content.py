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
import collections
import json
import math
import os
import random
import re
import signal
import sqlite3
import statistics
import sys
import time
import unicodedata
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
        """The row's IDENTITY — `name, area, city`. No longer what gets sent.

        This stays the full triple because it is the primary key and has to be
        stable across runs. What we *ask* the geocoder is `queries()` below.
        """
        return ", ".join(p for p in (self.name, self.area, self.city) if p)

    @property
    def key(self) -> str:
        return self.query.strip().lower()

    def queries(self) -> list[tuple[str, str]]:
        """The ladder of (precision, query) to try, likeliest first.

        The first version of this script sent `name, area, city` and nothing
        else, and measured a **97% miss rate over 265 lookups** (258 not_found,
        6 ok). The cause is that a comma-separated query is read as an address
        *hierarchy*: every component has to match something real, and in this
        content every place has an `area` that is descriptive prose rather than
        an addressable one — "camino a Toconao", "Mala car park trailhead",
        "Coral Sea", "Sycamore Canyon Road". One unmatchable component empties
        the whole result, so the extra specificity intended to *disambiguate*
        (KI-39) was instead guaranteeing a miss.

        So the area is dropped from the first ask and kept only as a fallback
        for the case it is genuinely a neighbourhood. The rungs are ordered by
        how likely they are to answer, because every rung costs a request:

          venue  `name, city`   the real target
          area   `area, city`   a neighbourhood pin when the venue is unknown —
                                also the only rung that helps the stops whose
                                `name` is an activity, not a place ("Return
                                crossing to Port Douglas")
          city   `city`         handled separately and shared across every place
                                in that city, so it costs one request per city
                                rather than one per stop
        """
        rungs: list[tuple[str, str]] = []
        if self.name and self.city:
            rungs.append(("venue", f"{self.name}, {self.city}"))
        elif self.name:
            rungs.append(("venue", self.name))
        # Only worth a request if it says something the city does not.
        if self.area and self.area.lower() != self.city.lower():
            rungs.append(("area", ", ".join(p for p in (self.area, self.city) if p)))
        return rungs


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
    # Additive migrations, so a cache part-way through a run keeps the answers
    # it already paid for. `precision` records WHICH rung of the ladder
    # answered, which is what lets --apply treat a venue hit and a city centre
    # differently instead of pretending they are the same fact.
    have = {r[1] for r in db.execute("pragma table_info(places)")}
    for col, decl in (("precision", "text"), ("query_used", "text")):
        if col not in have:
            db.execute(f"alter table places add column {col} {decl}")
    db.execute(
        """
        create table if not exists cities (
          city          text primary key,
          status        text not null default 'pending',
          lat           real,
          lng           real,
          display_name  text,
          attempts      integer not null default 0,
          last_error    text,
          updated_at    text
        )
        """
    )
    db.execute("create table if not exists meta (k text primary key, v text)")
    db.commit()
    return db


# Bump when the QUESTION changes, not when the code does. A place recorded as
# not_found was asked a question this version no longer asks, so its answer is
# not evidence about the new one and the row is re-queued automatically.
STRATEGY = "5-word-set-city-test"


def apply_strategy(db: sqlite3.Connection) -> int:
    """Re-queue answers that a previous strategy produced. Returns how many."""
    row = db.execute("select v from meta where k='strategy'").fetchone()
    if row and row[0] == STRATEGY:
        return 0
    n = db.execute(
        "update places set status='pending', attempts=0, last_error=null "
        "where status in ('not_found','rejected')"
    ).rowcount
    # City-precision answers came from a bare-city query that could not say
    # WHICH Santa Cruz, so they and their anchors are discarded outright.
    n += db.execute(
        "update places set status='pending', attempts=0, lat=null, lng=null, "
        "precision=null where precision='city'"
    ).rowcount
    db.execute("delete from cities")
    db.execute("insert or replace into meta (k,v) values ('strategy',?)", (STRATEGY,))
    db.commit()
    return n


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

    def request_url(self, query: str, countrycodes: str | None = None) -> str:
        params = {
            "q": query,
            "format": "json",
            "addressdetails": "1",
            # Five, not one. The top hit is whatever the provider ranked first,
            # which for a venue name is often the wrong city entirely; asking
            # for a handful and letting `judge` pick the first that agrees with
            # our own city costs exactly the same one request.
            "limit": "5",
            # Romanised names, matching the app's own adapter: what this decides
            # is how a place is SPELLED IN STORAGE, not how one reader sees it.
            "accept-language": "en",
        }
        if countrycodes:
            # Both Nominatim and LocationIQ take this. A bare city name is
            # globally ambiguous — "Santa Cruz" alone answers with Bolivia —
            # and this is the supported way to say which one we mean.
            params["countrycodes"] = countrycodes.lower()
        key = self.key
        if key:
            params["key"] = key
        return f"{self.url}?{urllib.parse.urlencode(params)}"

    def lookup(self, query: str, countrycodes: str | None = None) -> list[dict]:
        req = urllib.request.Request(
            self.request_url(query, countrycodes),
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
            return []
        return rows if isinstance(rows, list) else []


ENV_FILES = ("apps/web/.env.local", ".env.local", ".env")


def env_file_keys() -> dict[str, str]:
    """LOCATIONIQ_* entries from the repo's env files.

    The key lives in `apps/web/.env.local` because that is where the app wants
    it, and requiring it be exported by hand as well is a trap: an empty
    variable silently produces a Nominatim run that looks exactly like a working
    one. Read the file the key is already in.

    Deliberately not a dotenv parser — just KEY=VALUE, with optional `export`
    and matched surrounding quotes stripped, which is the whole grammar these
    files use for this variable.
    """
    found: dict[str, str] = {}
    for rel in ENV_FILES:
        path = REPO / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):].strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            name, value = name.strip(), value.strip()
            if not name.startswith("LOCATIONIQ_API_KEY"):
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            # An earlier file wins, and a real environment variable beats both.
            found.setdefault(name, value.strip())
    return found


def key_diagnosis() -> str:
    """Why there is no key, specifically. Blank when there is one.

    "No key found" is the wrong message when the variable is right there but
    empty, which is the state a freshly-provisioned `.env.local` is in — and it
    is indistinguishable from "not set" unless something says so.
    """
    env_set = [n for n in os.environ if n.startswith("LOCATIONIQ_API_KEY")]
    env_empty = [n for n in env_set if not (os.environ.get(n) or "").strip()]
    files = {rel: (REPO / rel) for rel in ENV_FILES if (REPO / rel).is_file()}
    file_names = env_file_keys()
    empty_in_file = [n for n, v in file_names.items() if not v]

    if env_empty and len(env_empty) == len(env_set):
        return (f"  {env_empty[0]} is set in your shell but EMPTY — that is why. "
                f"Give it a value, or pass --key.")
    if empty_in_file:
        where = ", ".join(files) or "the env file"
        return (f"  {empty_in_file[0]} is present in {where} but has no value — "
                f"that is why. Fill it in, or pass --key.")
    if not env_set and not file_names:
        looked = ", ".join(ENV_FILES)
        return (f"  no LOCATIONIQ_API_KEY in the environment or in {looked}. "
                f"Pass --key, or add it to apps/web/.env.local.")
    return "  no usable LocationIQ key found. Pass --key, or set LOCATIONIQ_API_KEY."


def api_keys(args) -> KeyRing:
    """`--key`, then the environment, then the repo's env files."""
    keys: list[str] = []
    if args.key:
        keys.append(args.key.strip())
    from_files = env_file_keys()
    names = ["LOCATIONIQ_API_KEY"] + [f"LOCATIONIQ_API_KEY_{n}" for n in range(1, 10)]
    for name in names:
        value = (os.environ.get(name) or "").strip() or from_files.get(name, "")
        value = value.strip()
        if value and value not in keys:
            keys.append(value)
    return KeyRing(keys)


def build_provider(args) -> Provider:
    ring = api_keys(args)
    if args.provider == "nominatim":
        # An explicit opt-out. Since the key is discovered from
        # apps/web/.env.local automatically, there was otherwise no way to NOT
        # use it short of editing the file — and Nominatim is the right choice
        # whenever LocationIQ's DAILY cap is the binding constraint rather than
        # its rate, because Nominatim has no daily cap at all.
        ring = KeyRing([])
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


# Letters NFKD does not decompose, because they are not accented letters — they
# are letters in their own right. A geocoder answering in the local script and a
# bundle written in the English one disagree on every one of these.
_LETTER_FOLD = str.maketrans({
    "ð": "d", "Ð": "d", "þ": "th", "Þ": "th", "ø": "o", "Ø": "o",
    "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ß": "ss",
    "ı": "i", "İ": "i", "ł": "l", "Ł": "l", "đ": "d", "Đ": "d",
    "ʻ": "", "'": "", "’": "", "`": "",
})


# Greek and Cyrillic, romanised. Nominatim honours `accept-language` for
# display_name only when a localised name exists; where it does not, the answer
# comes back in the local script and no amount of accent-stripping will match it
# against a bundle written in English.
_SCRIPT_FOLD = str.maketrans({
    "α":"a","β":"v","γ":"g","δ":"d","ε":"e","ζ":"z","η":"i","θ":"th","ι":"i",
    "κ":"k","λ":"l","μ":"m","ν":"n","ξ":"x","ο":"o","π":"p","ρ":"r","σ":"s",
    "ς":"s","τ":"t","υ":"y","φ":"f","χ":"ch","ψ":"ps","ω":"o",
    "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i",
    "й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s",
    "т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"shch",
    "ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya",
})


def words(text: str) -> set[str]:
    """The folded word-set of a place name, for comparing identity not spelling."""
    return {w for w in re.split(r"[^a-z0-9]+", fold(text)) if w}


def squash(text: str) -> str:
    """`fold`, then drop everything that is not a letter or digit.

    `Hanoi` and `Hà Nội` are the same city; folding alone leaves `hanoi` against
    `ha noi`, and the space is the whole difference. Spacing and punctuation
    carry no information here — the city test's job is identity, not formatting.
    """
    return "".join(c for c in fold(text) if c.isalnum())


def fold(text: str) -> str:
    """Casefold and strip accents, so `Reykjavík` matches `Reykjavik`.

    This exists because it was measured, not imagined: the first full run
    rejected correct results for `Reykjavík` (matched "Reykjavik, Capital
    Region, Iceland") and `Uluru-Kata Tjuta National Park` (matched
    "Uluṟu-Kata Tjuṯa National Park"). The geocoder had found exactly the right
    place and the city test threw it away over a diacritic. 141 of the 1,344
    places sit in a city whose name carries a non-ASCII character, so this is
    not an edge case.

    NFKD handles the combining accents; the table above handles the letters it
    leaves alone (ð, ø, ı, ł and friends), which are not decomposable because
    they are distinct letters rather than decorated ones.
    """
    # Order matters: strip the combining marks FIRST, so Greek `ό` becomes `ο`
    # and reaches the transliteration table. Doing it the other way round leaves
    # every accented Greek vowel untranslated, which is how `Φιλότι` survived an
    # earlier version of this function still looking like Greek.
    lowered = text.casefold()
    bare = "".join(c for c in unicodedata.normalize("NFKD", lowered)
                   if not unicodedata.combining(c))
    return bare.translate(_LETTER_FOLD).translate(_SCRIPT_FOLD)


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

    display = row.get("display_name") or ""
    address = row.get("address") or {}

    # The city test. A stop's `city` is the field Discover matches on and the
    # one thing about a place we are certain of, so a result that landed in a
    # different city is wrong however plausible it looks.
    if place.city:
        # Compare WORD SETS, not substrings. Raw containment accepted `Oia`
        # against `Oiartzun` — a different town in a different country — because
        # one name happens to begin with the other, and it rejected
        # `Vík í Mýrdal` against `Vik` because containment only ran one way.
        # Word sets get both right: one name's words being a subset of the
        # other's is real agreement, while a shared prefix is not.
        wanted_sq, wanted_w = squash(place.city), words(place.city)
        candidates = [str(address.get(k, "")) for k in SETTLEMENT_KEYS]
        candidates += [part for part in str(display).split(",")]

        def agrees(cand: str) -> bool:
            if not cand.strip():
                return False
            if squash(cand) == wanted_sq:      # Hanoi == Hà Nội, Filoti == Φιλότι
                return True
            cw = words(cand)
            if not cw or not wanted_w:
                return False
            return cw <= wanted_w or wanted_w <= cw

        if not any(agrees(c) for c in candidates):
            return False, f"result is not in {place.city} (got: {row.get('display_name', '?')[:90]})"

    return True, "ok"


def judge_best(place: Place, rows: list[dict]) -> tuple[dict | None, str]:
    """The first candidate that agrees with our own city, or nothing.

    `judge` decides one result. This picks among five, which is the point of
    asking for five: a venue name that repeats across countries puts the right
    answer somewhere below the first row surprisingly often.
    """
    if not rows:
        return None, "no result"
    reasons = []
    for row in rows:
        accept, reason = judge(place, row)
        if accept:
            return row, "ok"
        reasons.append(reason)
    return None, reasons[0] if reasons else "no usable result"


def distance_km(alat: float, alng: float, blat: float, blng: float) -> float:
    """Great-circle distance, haversine.

    The previous approximation scaled longitude by `1 - |lat|/90` where the
    correct factor is `cos(lat)`. Measured against known pairs it ran 8-34%
    SHORT — Reykjavík to Vík came out 124km against a real 187 — so every
    reported outlier distance was an underestimate and some real ones fell under
    the threshold entirely. Haversine costs two trig calls and removes the whole
    class of question.
    """
    r = 6371.0088
    p1, p2 = math.radians(alat), math.radians(blat)
    dp, dl = p2 - p1, math.radians(blng - alng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def audit_cities(db: sqlite3.Connection, km: float = 50.0) -> dict[str, dict]:
    """Classify a city's pins against its anchor, and say which half is wrong.

    The first version compared the anchor to the MEDIAN of a city's pins and
    blamed the anchor. Watkins Glen showed why that is not enough: two venues
    matched North Franklin Street in New York correctly, and two matched a
    "Watkins Glen" street in Paradise, NEVADA. The median of a bimodal split
    sits between the clusters — in that case Kansas, where nothing is — so the
    report accused a correct anchor and withheld two correct pins along with the
    two wrong ones.

    A median cannot describe a split. Counting can:

      healthy      every pin agrees with the anchor.
      bad-pins     most pins agree with the anchor, a minority does not. The
                   anchor has corroboration; the outliers are wrong. Withhold
                   only those.  (Watkins Glen: 2 New York, 2 Nevada.)
      bad-anchor   no pin agrees with the anchor, but they agree with each
                   other. Many independent lookups beat one. Keep the pins,
                   drop the anchor.  (Koh Lanta: anchor in Bangkok.)
      split        no agreement anywhere. Withhold everything: the evidence does
                   not say which is right, and KI-39's lesson is that a
                   confidently wrong pin costs more than a missing one.
                   (Fuente De: anchor in Veracruz, pins near Guadalajara, and
                   the real place is in Spain.)
    """
    out: dict[str, dict] = {}
    anchors = db.execute(
        "select city, lat, lng from cities where status='ok' and lat is not null").fetchall()
    for city, alat, alng in anchors:
        pins = db.execute(
            "select key, query, coalesce(display_name,''), lat, lng, coalesce(precision,'venue') "
            "from places where status='ok' and city=? and lat is not null "
            "and coalesce(precision,'venue') in ('venue','area') order by query", (city,)
        ).fetchall()
        if len(pins) < 2:
            continue  # one pin and an anchor is two opinions and no majority

        near = [p for p in pins if distance_km(alat, alng, p[3], p[4]) <= km]
        far = [p for p in pins if distance_km(alat, alng, p[3], p[4]) > km]
        if not far:
            continue

        if near and len(near) >= len(far):
            verdict, bad = "bad-pins", far
        else:
            # Do the disagreeing pins at least agree with each other?
            mlat = statistics.median(p[3] for p in far)
            mlng = statistics.median(p[4] for p in far)
            cohesive = all(distance_km(mlat, mlng, p[3], p[4]) <= km for p in far)
            if cohesive and not near:
                verdict, bad = "bad-anchor", []
            else:
                verdict, bad = "split", pins

        out[city] = {
            "verdict": verdict,
            "anchor": (alat, alng),
            "agreeing": len(near),
            "disagreeing": len(far),
            "withhold": [p[0] for p in bad],
            "dropAnchor": verdict in ("bad-anchor", "split"),
            "pins": [
                {"query": q, "matched": dn, "lat": round(la, 5), "lng": round(ln, 5),
                 "precision": pr,
                 "kmFromAnchor": round(distance_km(alat, alng, la, ln), 1),
                 "verdict": "disagrees" if (k in {b[0] for b in far}) else "agrees",
                 "map": f"https://www.openstreetmap.org/?mlat={la}&mlon={ln}#map=14/{la}/{ln}"}
                for k, q, dn, la, ln, pr in pins
            ],
        }
    return out


def far_from_anchor(db: sqlite3.Connection, km: float = 40.0) -> list[tuple]:
    """Accepted pins measured against their own city's resolved centre.

    Better baseline than the median of sibling results: it exists for EVERY
    city, including the ones with one or two stops that the median check had to
    skip, and it cannot be dragged by a cluster of bad pins. This is the list to
    read when judging whether an `area` hit — "something in the right city that
    matched a prose string" — actually landed anywhere sensible.
    """
    # Skip cities whose anchor failed the audit. Measuring a correct venue
    # against a wrong anchor produces an outlier report full of places that are
    # not outliers, which is exactly what the first real review looked like.
    # Only skip a city whose ANCHOR is the untrustworthy half. Where the anchor
    # is corroborated ("bad-pins"), measuring against it is exactly right.
    audit = audit_cities(db)
    suspect = {c for c, v in audit.items() if v["dropAnchor"]}
    anchors = {c: (la, ln) for c, la, ln
               in db.execute("select city, lat, lng from cities where status='ok'")
               if c not in suspect}
    out = []
    for q, city, lat, lng, prec, disp in db.execute(
        "select query, city, lat, lng, coalesce(precision,'venue'), coalesce(display_name,'') "
        "from places where status='ok' and lat is not null "
        "and coalesce(precision,'venue') != 'city'"
    ):
        a = anchors.get(city)
        if not a:
            continue
        d = distance_km(a[0], a[1], lat, lng)
        if d > km:
            # The MATCH itself, not just the distance. "40km out" cannot be
            # judged without knowing what was matched — a remote trailhead and a
            # same-named town in the next country look identical as a number,
            # and only one of them is wrong. Carrying the display name and the
            # coordinates makes the review file answerable on its own, without
            # the database that produced it.
            out.append((q, city, round(d, 1), prec, disp, round(lat, 5), round(lng, 5)))
    return sorted(out, key=lambda r: -r[2])


def flag_outliers(db: sqlite3.Connection, km: float = 60.0) -> list[tuple[str, str, float]]:
    """Accepted results that sit absurdly far from the rest of their own city.

    The city test above catches a result in the wrong city. This catches the
    other half — a result the provider labelled with the right city that is
    nowhere near the others carrying that label, which is what a wrong-venue
    match looks like when the venue happens to share a name with somewhere in
    the suburbs. Reported, never auto-rejected: a genuinely remote trailhead
    outside a small town is a real place and this would flag it too.
    """
    # City-centre fallbacks are excluded from BOTH sides. They all sit on one
    # point per city, so including them drags the median onto the city centre
    # and hides exactly the wrong-venue outlier this exists to catch — and
    # flagging them as outliers is meaningless, since being the city centre is
    # what they are.
    rows = db.execute(
        "select key, query, city, lat, lng from places "
        "where status='ok' and city != '' and coalesce(precision,'venue') != 'city'"
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


def one_request(provider, place: Place, query: str, stopping, db, args, progress,
                countrycodes: str | None = None):
    """One lookup, with the shared 429/backoff handling. Returns (rows, err).

    Raises DailyCapReached upward — that one is not this function's to absorb.
    """
    tries = 0
    limited = 0
    while True:
        try:
            return provider.lookup(query, countrycodes), None
        except RateLimited as exc:
            # Bounded, not endless. This branch used to `continue` with no
            # counter, so a provider answering 429 to everything spun forever
            # with no output and no way to tell it from a hang.
            limited += 1
            if limited > args.max_rate_limit_retries:
                return None, (f"still rate limited after {limited - 1} waits — "
                              f"raise --interval")
            wait = exc.retry_after or provider.min_interval * 4
            wait = min(max(wait, provider.min_interval * 2), args.max_backoff)
            progress.interrupt(f"  · rate limited {limited}/{args.max_rate_limit_retries}"
                               f" — sleeping {wait:.0f}s ({query[:44]})")
            slept = 0.0
            while slept < wait and not stopping.now:
                time.sleep(min(1.0, wait - slept))
                slept += 1.0
            if stopping.now:
                return None, "stopped"
            continue
        except Transient as exc:
            # Retry in place, backing off. The refactor that introduced this
            # helper dropped the escalation the inline handler used to do, and a
            # transient became an instant permanent-ish failure: 318 of 1,344 on
            # the first full run, against 44 genuine not_founds. A timeout or a
            # 5xx is the provider asking for room, and the answer is to give it
            # some rather than to march on at the same rate.
            tries += 1
            if tries > args.max_transient_retries:
                return None, str(exc)[:200]
            wait = min(provider.min_interval * (2 ** tries), args.max_backoff)
            progress.interrupt(
                f"  · {str(exc)[:60]} — retry {tries}/{args.max_transient_retries} "
                f"in {wait:.0f}s ({query[:40]})")
            slept = 0.0
            while slept < wait and not stopping.now:
                time.sleep(min(1.0, wait - slept))
                slept += 1.0
            if stopping.now:
                return None, "stopped"
            continue


def learned_countries(db) -> dict[str, str]:
    """city -> ISO2, by majority vote of the venue hits already accepted in it.

    The bundles carry no country (`countryCode` is something the geocoder
    POPULATES, per ADR-007), so it has to be learned. A venue that resolved and
    passed the city test is the strongest evidence available about which
    country a city name means, and it costs nothing — it is already in the row.
    """
    votes: dict[str, collections.Counter] = {}
    for city, cc in db.execute(
        "select city, country_code from places where status='ok' and country_code is not null "
        "and coalesce(precision,'venue') in ('venue','area')"
    ):
        votes.setdefault(city, collections.Counter())[cc] += 1
    return {c: v.most_common(1)[0][0] for c, v in votes.items() if v}


def city_anchors(db, provider, args, stopping, progress, only: set[str] | None = None) -> dict:
    """Resolve a city centre once, scoped to the country its venues landed in.

    Runs AFTER the places, not before, and that ordering is the whole point. A
    bare city name is globally ambiguous — the first real run anchored "Santa
    Cruz" in Bolivia and then flagged the correct California venue as 8,107km
    out — and the only thing that disambiguates it here is where that city's own
    venues actually resolved. So the venues go first and the anchors inherit
    their country.
    """
    wanted = only if only is not None else {p.city for p in places().values() if p.city}
    db.executemany("insert or ignore into cities (city) values (?)", [(c,) for c in wanted])
    db.commit()
    countries = learned_countries(db)
    todo = [r for r in db.execute(
        "select city from cities where status in ('pending','failed') and attempts < ? "
        "order by city", (args.max_attempts,)).fetchall() if r[0] in wanted]
    if not todo:
        return {c: (la, ln) for c, la, ln
                in db.execute("select city, lat, lng from cities where status='ok'")}

    # This pass gets its OWN live line. It was silent behind --verbose in the
    # first cut, which at Nominatim's 1.1s meant six unexplained minutes before
    # the first place — the same "is it hung?" failure the status line exists to
    # prevent, reintroduced in a new code path.
    mins = len(todo) * provider.min_interval / 60
    progress.interrupt(
        f"  resolving {len(todo)} city centres first — one request each, reused by "
        f"every stop in them\n  this takes about {mins:.0f} min at "
        f"{provider.min_interval:.2f}s/request, and nothing else happens until it is done")
    done_c = db.execute("select count(*) from cities where status='ok'").fetchone()[0]
    total_c = db.execute("select count(*) from cities").fetchone()[0]
    cp = Progress(len(todo), len(todo), total_c, args.progress_every)
    seen = 0

    for (city,) in todo:
        if stopping.now:
            break
        place = Place(city, "", city)
        cc = countries.get(city)
        rows, err = one_request(provider, place, city, stopping, db, args, progress, cc)
        if err == "stopped":
            break
        status, lat, lng, disp = "failed", None, None, None
        if rows is not None:
            row, reason = judge_best(place, rows)
            if row:
                status, lat, lng = "ok", float(row["lat"]), float(row["lon"])
                disp = row.get("display_name")
            else:
                status, err = "not_found", reason
        db.execute("update cities set status=?, lat=?, lng=?, display_name=?, "
                   "attempts=attempts+1, last_error=?, updated_at=? where city=?",
                   (status, lat, lng, disp, err,
                    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), city))
        db.commit()
        seen += 1
        done_c += 1 if status == "ok" else 0
        cp.tick(done_c, seen, f"city  {city[:52]}")
        time.sleep(provider.min_interval + random.uniform(0, 0.25))
    cp.done()
    got = db.execute("select city, lat, lng from cities where status='ok'").fetchall()
    return {c: (la, ln) for c, la, ln in got}


def work(db: sqlite3.Connection, provider: Provider, args) -> None:
    stopping = Stopping()
    todo = db.execute(
        f"select key, query, name, area, city, attempts from places "
        f"where status in ({','.join('?' * len(RETRYABLE))}) "
        f"and attempts < ? order by attempts, key",
        (*RETRYABLE, args.max_attempts),
    ).fetchall()

    total_remaining = len(todo)
    if args.sample:
        # Random, not the first N. The queue is ordered by key, so `--max-requests`
        # samples the alphabet rather than the content and tells you very little
        # about the real hit rate.
        random.seed()
        todo = random.sample(todo, min(args.sample, len(todo)))
    if args.max_requests:
        todo = todo[: args.max_requests]
    if not todo:
        print("  nothing to do — every place is settled. `--review` to see what needs eyes.")
        return

    done_all = db.execute("select count(*) from places where status not in ('pending','failed')").fetchone()[0]
    grand = db.execute("select count(*) from places").fetchone()[0]
    print(f"  provider {provider.name} at {provider.min_interval:.2f}s between requests")
    if provider.name == "nominatim":
        # Say this loudly. Falling back to Nominatim is silent, roughly halves
        # the speed, and looks identical to a working LocationIQ run until you
        # notice the banner — which cost a confusing six minutes once already.
        print("  NOTE: this is the free public Nominatim (OpenStreetMap's own "
              "geocoder — same data\n        as LocationIQ, no key, but ~1 request/s "
              "and no uptime promise).\n        Your LocationIQ quota is NOT being "
              "used.")
        print(key_diagnosis())
    if len(provider.keys.keys) > 1:
        print("  keys are used one at a time, in order — a second key is a second DAY's "
              "quota, never a faster rate")
    print(f"  {len(todo)} this run · {total_remaining} outstanding · {grand} places total\n")

    progress = Progress(len(todo), total_remaining, grand, args.progress_every)
    backoff = provider.min_interval
    processed = 0

    anchors: dict = {}
    capped = 0

    for key, query, name, area, city, attempts in todo:
      try:
        if stopping.now:
            break
        place = Place(name, area, city)
        status, lat, lng, display, cc, rcity = "not_found", None, None, None, None, None
        precision, used, err = None, None, "no result"

        # Walk the ladder. Stop at the first rung that answers, so a venue that
        # resolves cleanly never costs a second request.
        for rung, q in place.queries():
            if stopping.now:
                break
            rows, rerr = one_request(provider, place, q, stopping, db, args, progress)
            if rerr == "stopped":
                break
            if rows is None:
                status, err, used = "failed", rerr, q
                break
            row, reason = judge_best(place, rows)
            if row:
                status, precision, used = "ok", rung, q
                lat, lng = float(row["lat"]), float(row["lon"])
                display = row.get("display_name")
                address = row.get("address") or {}
                cc = (address.get("country_code") or "").upper() or None
                rcity = next((address[k] for k in SETTLEMENT_KEYS if address.get(k)), None)
                err = None
                break
            status, err, used = "not_found", reason, q
            time.sleep(provider.min_interval + random.uniform(0, 0.25))

        # Never record a failure without a reason. 317 rows came back `failed`
        # with last_error NULL and no path in this loop accounts for it, which
        # left the biggest bucket in the run unexplainable after the fact. If it
        # happens again this says which branch produced it instead of nothing.
        if status == "failed" and not err:
            err = (f"no reason captured — rungs={len(place.queries())}, "
                   f"stopping={stopping.now}, provider={provider.name}")

        db.execute(
            """update places set status=?, lat=?, lng=?, display_name=?, country_code=?,
                                 result_city=?, provider=?, attempts=attempts+1,
                                 last_error=?, precision=?, query_used=?, updated_at=?
               where key=?""",
            (status, lat, lng, display, cc, rcity, provider.name, err, precision, used,
             time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), key),
        )
        db.commit()  # after EVERY row: this is what makes a kill -9 cheap

        processed += 1
        done_all += 1 if status != "failed" else 0
        label = f"{(precision or status):9s} {(used or query)[:52]}"
        progress.tick(done_all, processed, label)

        time.sleep(backoff + random.uniform(0, 0.25))
      except DailyCapReached as exc:
        progress.done()
        # Record the reason on the row. Skipping the write left the place in
        # whatever state it already held and never touched `attempts`, so a
        # capped run reported "318/318 this run" and changed nothing — a silent
        # no-op indistinguishable from a fix that did not work. Status stays
        # retryable and attempts stay put: not being attempted is not a failure.
        db.execute(
            "update places set last_error=?, updated_at=? where key=?",
            ("daily quota reached before this place was attempted",
             time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), key))
        db.commit()
        capped += 1
        if not provider.keys.retire(str(exc)[:60]):
            print(f"  every key is out of requests for the day — {capped} place(s) "
                  f"were not attempted.\n  Re-run tomorrow; the queue resumes here.")
            break
        continue

    progress.done()

    # Phase 2: anchor only the cities that still have an unresolved place, now
    # that their venues can say which country they are in.
    need = {c for (c,) in db.execute(
        "select distinct city from places where status='not_found' and city != ''")}
    if need and not stopping.now:
        try:
            anchors = city_anchors(db, provider, args, stopping, progress, only=need)
        except DailyCapReached:
            print("  out of quota before the city fallbacks. Re-run to finish them.")
            anchors = {}
    else:
        anchors = {c: (la, ln) for c, la, ln
                   in db.execute("select city, lat, lng from cities where status='ok'")}

    # Phase 3: hand the leftovers their city centre. Pure bookkeeping — every
    # coordinate here was already paid for in phase 2.
    filled = 0
    for key, city in db.execute(
        "select key, city from places where status='not_found' and city != ''").fetchall():
        hit = anchors.get(city)
        if not hit:
            continue
        db.execute("update places set status='ok', lat=?, lng=?, precision='city', "
                   "query_used=?, display_name=?, last_error=null, updated_at=? where key=?",
                   (hit[0], hit[1], city, f"(city centre) {city}",
                    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), key))
        filled += 1
    if filled:
        db.commit()
        print(f"  {filled} place(s) fell back to their city centre "
              f"(held back by --apply unless --include-city-level)")

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
    prec = db.execute(
        "select coalesce(precision,'?'), count(*) from places where status='ok' group by 1"
    ).fetchall()
    if prec:
        label = {"venue": "the venue itself", "area": "its neighbourhood",
                 "city": "the city centre only"}
        print("  of which —")
        for name, n in sorted(prec, key=lambda r: -r[1]):
            print(f"    {name:8s} {n:5d}  {label.get(name, '')}")
    # WHY, not just how many. A wall of `failed` says nothing about whether the
    # provider is throttling, the network wobbled, or a key expired — and those
    # want completely different responses.
    # Split them. `not_found` is the geocoder answering "nothing there" or the
    # city test refusing a candidate; `failed` is the request itself breaking.
    # Grouping them together hid exactly that distinction on the run that
    # mattered, and they call for completely different responses.
    for status, heading in (("not_found", "rejected or unmatched"),
                            ("failed", "the request itself failed")):
        # coalesce, not `is not null`: filtering out the rows with no recorded
        # reason made 317 failures print NOTHING, and an empty section reads as
        # "no failures" rather than as "no explanation" — which is itself the
        # single most useful thing the report could have said.
        rows = db.execute(
            "select coalesce(last_error,'(no reason recorded — see --diagnose)'), count(*) "
            "from places where status=? group by 1 order by 2 desc limit 5", (status,)).fetchall()
        if rows:
            print(f"  {heading} —")
            for why, n in rows:
                print(f"    {n:5d}  {str(why)[:86]}")
    stuck = db.execute(
        "select count(*) from places where status='failed' and attempts >= ?",
        (3,),
    ).fetchone()[0]
    if stuck:
        print(f"  {stuck} have failed 3+ times — `--retry-failed` resets them, or look at --review")
    retryable = db.execute("select count(*) from places where status='failed'").fetchone()[0]
    if retryable:
        print(f"  {retryable} failed place(s) are retried automatically by the next run — "
              f"failures are transient, not verdicts")


def write_review(db: sqlite3.Connection) -> dict:
    rejected = db.execute(
        "select query, city, display_name, last_error from places where status='rejected' order by city, query"
    ).fetchall()
    missing = db.execute(
        "select query, city, last_error from places where status in ('not_found','failed') order by city, query"
    ).fetchall()
    outliers = flag_outliers(db)
    far = far_from_anchor(db)
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
        # The list to actually read. An `area` hit is only "something in the
        # right city that matched a prose string", so distance from the city's
        # own resolved centre is the cheapest signal that it landed somewhere
        # absurd — and unlike the median check this exists for every city, not
        # only those with three or more results.
        # Anchors the evidence says are wrong. Read this BEFORE the outlier
        # list: a bad anchor puts correct venues in it.
        # NOTE: this says the two disagree, NOT which one is wrong. Both
        # coordinates are given so a person can tell — and both are withheld by
        # --apply until one does.
        # Says WHICH half is wrong, and why. `verdict` is one of:
        #   bad-pins    the anchor is corroborated; the listed pins are wrong
        #   bad-anchor  the pins agree with each other; the anchor is wrong
        #   split       no agreement; everything here is withheld
        "cityDisagreements": [
            {"city": c, "verdict": v["verdict"], "agreeing": v["agreeing"],
             "disagreeing": v["disagreeing"],
             "anchor": {"lat": v["anchor"][0], "lng": v["anchor"][1]},
             "pinsWithheld": len(v["withhold"]), "pins": v["pins"]}
            for c, v in sorted(audit_cities(db).items(), key=lambda kv: -kv[1]["disagreeing"])
        ],
        "farFromCityCentre": [
            {"query": q, "city": c, "kmFromCentre": d, "precision": pr,
             "matched": disp, "lat": lat, "lng": lng,
             "map": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lng}#map=14/{lat}/{lng}"}
            for q, c, d, pr, disp, lat, lng in far
        ],
    }
    REVIEW.write_text(json.dumps(review, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return review


def retract(db: sqlite3.Connection, dry_run: bool) -> None:
    """Removes coordinates already written that this pass would now refuse.

    `apply` skips a stop that already has a `lat` — the rule that makes a
    hand-authored coordinate permanent. The cost is that a coordinate written
    before a defect was found is equally permanent, and every fix to the audit
    arrives too late for the runs it should have prevented. Watkins Glen State
    Park went into a bundle pointing at a street in Paradise, Nevada, and no
    amount of re-running would take it back out.

    Only a coordinate that MATCHES what the cache holds is removed. A value that
    differs was put there by a person, and the whole point of the skip rule is
    that a person's coordinate outranks this script's — so the one thing this
    must never do is delete somebody's correction because the tool now disagrees
    with it.
    """
    audit = audit_cities(db)
    condemned = {k for v in audit.values() for k in v["withhold"]}
    if not condemned:
        print("  nothing to retract — no written pin is condemned by the audit.")
        return
    cached = {
        key: (lat, lng)
        for key, lat, lng in db.execute(
            "select key, lat, lng from places where lat is not null")
    }

    removed = kept = 0
    for path in bundle_files():
        bundle = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        for stop in stops_of(bundle):
            loc = stop.get("location") or {}
            name = (loc.get("name") or "").strip()
            if not name or "lat" not in loc:
                continue
            place = Place(name, (loc.get("area") or "").strip(), (loc.get("city") or "").strip())
            if place.key not in condemned:
                continue
            was = cached.get(place.key)
            if not was or abs(loc["lat"] - was[0]) > 1e-6 or abs(loc["lng"] - was[1]) > 1e-6:
                kept += 1  # a person's value, not this script's
                continue
            del loc["lat"], loc["lng"]
            changed = True
            removed += 1
        if changed and not dry_run:
            path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    verb = "would remove" if dry_run else "removed"
    print(f"  {verb} {removed} coordinate(s) the audit condemns")
    if kept:
        print(f"  left {kept} alone — they differ from the cache, so a person wrote them")


def apply(db: sqlite3.Connection, dry_run: bool, include_city: bool = False) -> None:
    """Writes accepted coordinates into the bundles. Never writes a rejected one.

    City-centre fallbacks are held back unless asked for. They are true — that
    IS where the city is — but pinning every stop of a day to one point draws a
    map that says something false about the day, and KI-39's lesson is that a
    confidently wrong pin costs more than a missing one.
    """
    allowed = ("venue", "area") + (("city",) if include_city else ())
    good = {
        key: (lat, lng)
        for key, lat, lng in db.execute(
            f"select key, lat, lng from places where status='ok' and lat is not null "
            f"and coalesce(precision,'venue') in ({','.join('?' * len(allowed))})",
            allowed,
        )
    }
    held_city = db.execute(
        "select count(*) from places where status='ok' and precision='city'"
    ).fetchone()[0]
    if held_city and not include_city:
        print(f"  holding back {held_city} city-centre fallback(s) — "
              f"--include-city-level writes them too")

    # A city pin is only as good as its anchor, and the audit says which anchors
    # are not. These are dropped even under --include-city-level: the flag says
    # "a city centre is good enough here", not "write a point the evidence says
    # is in the wrong place".
    # When a city's anchor and its venue cluster disagree, hold back EVERY pin
    # in that city, not just the city one.
    #
    # The first version of this assumed the anchor was always the wrong half —
    # "an anchor is one lookup, venues are many". The first real review refuted
    # it: Watkins Glen's anchor was correct at 42.381,-76.871 and its four
    # venues had all matched a Franklin Street in KANSAS, and Fuente De had both
    # halves wrong on two different continents. A cluster of venues agreeing
    # with each other is not evidence they are right — they can share one
    # mistake, and a street name in a small town is exactly the kind that
    # repeats.
    #
    # So the disagreement says one of them is wrong and does NOT say which.
    # Withholding both is the only reading that cannot write a pin in the wrong
    # country, which is the whole of KI-39.
    audit = audit_cities(db)
    withheld = {k for v in audit.values() for k in v["withhold"]}
    for key in withheld:
        good.pop(key, None)
    if audit:
        by_verdict: dict[str, int] = {}
        for v in audit.values():
            by_verdict[v["verdict"]] = by_verdict.get(v["verdict"], 0) + 1
        print(f"  {len(audit)} city/ies disagree with their own pins "
              f"({', '.join(f'{n} {k}' for k, n in sorted(by_verdict.items()))}) — "
              f"{len(withheld)} pin(s) withheld; see cityDisagreements in --review")

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
    ap.add_argument("--diagnose", action="store_true",
                    help="explain the failed/not_found buckets from the cache; no network")
    ap.add_argument("--review", action="store_true", help="write and summarise the review file")
    ap.add_argument("--apply", action="store_true", help="write accepted coordinates into the bundles")
    ap.add_argument("--retract", action="store_true",
                    help="remove already-written coordinates the audit now condemns")
    ap.add_argument("--dry-run", action="store_true", help="with --apply, report without writing")
    ap.add_argument("--retry-failed", action="store_true", help="reset failed rows so the next run retries them")
    ap.add_argument("--redo", action="store_true", help="reset EVERYTHING, including answers already paid for")
    ap.add_argument("--provider", choices=("auto", "nominatim"), default="auto",
                    help="'auto' uses a LocationIQ key if one is found; 'nominatim' "
                         "ignores any key and uses OpenStreetMap's own service, which "
                         "has no daily cap")
    ap.add_argument("--key", help="a LocationIQ key; also reads $LOCATIONIQ_API_KEY and "
                                  "$LOCATIONIQ_API_KEY_1..9, used one at a time as each "
                                  "hits its daily cap")
    ap.add_argument("--url", help="search endpoint to use instead (e.g. a self-hosted Nominatim)")
    ap.add_argument("--interval", type=float, help="seconds between requests (default: per provider)")
    ap.add_argument("--max-requests", type=int, help="stop after this many lookups this run")
    ap.add_argument("--sample", type=int, help="try a RANDOM N pending places and stop — "
                    "use this to measure the hit rate before spending the quota")
    ap.add_argument("--include-city-level", action="store_true",
                    help="with --apply, also write the city-centre fallbacks")
    ap.add_argument("--verbose", action="store_true", help="name each city as it resolves")
    ap.add_argument("--max-rate-limit-retries", type=int, default=8,
                    help="429 waits before a place is given up on for this run")
    ap.add_argument("--max-transient-retries", type=int, default=3,
                    help="retries for a timeout or 5xx before a place is marked failed")
    ap.add_argument("--max-attempts", type=int, default=4, help="give up on a place after this many tries")
    ap.add_argument("--max-backoff", type=float, default=300.0, help="longest sleep after a 429")
    ap.add_argument("--progress-every", type=int, default=10,
                    help="when output is piped to a file, print a line every N lookups "
                         "(on a terminal the status line updates every request regardless)")
    args = ap.parse_args()

    db = connect()
    # Both of these READ the cache and write to `content/`. Neither belongs
    # after `apply_strategy`, which deletes the cities table on a strategy
    # change — that would destroy the anchors the audit reasons from, and
    # silently change what --apply withholds. Nothing here re-queues anything.
    if args.retract:
        retract(db, args.dry_run)
        return
    if args.apply:
        apply(db, args.dry_run, args.include_city_level)
        return

    if args.diagnose:
        # Reads the cache only. No network, no quota — the answer to "what are
        # these failures" is already on disk after any run.
        for status in ("failed", "not_found", "rejected"):
            rows = db.execute(
                "select coalesce(last_error,'(no reason recorded)'), count(*) from places "
                "where status=? group by 1 order by 2 desc limit 12", (status,)).fetchall()
            total = sum(n for _, n in rows)
            if not total:
                continue
            print(f"\n  {status.upper()} — {total} place(s), by reason:")
            for why, n in rows:
                print(f"    {n:5d}  {str(why)[:100]}")
        stuck = db.execute(
            "select query, attempts, coalesce(last_error,'') from places "
            "where status='failed' order by attempts desc limit 8").fetchall()
        if stuck:
            print("\n  a sample of failed rows, most-attempted first:")
            for q, a, e in stuck:
                print(f"    attempts={a}  {q[:52]}\n              {e[:88]}")
        print(f"\n  attempt spread: " + ", ".join(
            f"{a}x:{n}" for a, n in db.execute(
                "select attempts, count(*) from places where status='failed' "
                "group by 1 order by 1")))
        return
    if args.redo:
        db.execute("update places set status='pending', attempts=0, last_error=null")
        db.commit()
        print("  reset every place to pending")
    if args.retry_failed:
        n = db.execute("update places set status='pending', attempts=0 where status='failed'").rowcount
        db.commit()
        print(f"  reset {n} failed place(s) to pending")

    requeued = apply_strategy(db)
    if requeued:
        print(f"  the query strategy changed since this cache was built — re-queued "
              f"{requeued} place(s) whose miss was recorded against the old question")

    added, seen = sync_queue(db)
    print(f"  {seen} distinct places across {len(bundle_files())} bundle(s)" + (f" (+{added} new)" if added else ""))

    if args.status:
        report(db)
        return
    if args.review:
        review = write_review(db)
        print(f"  {len(review['rejected'])} rejected · {len(review['unresolved'])} unresolved · "
              f"{len(review['cityDisagreements'])} city/ies disagreeing · "
              f"{len(review['farFromCityCentre'])} far from their city centre")
        print(f"  written to {REVIEW.relative_to(REPO)}")
        return
    work(db, build_provider(args), args)
    write_review(db)
    print(f"  review written to {REVIEW.relative_to(REPO)}")


if __name__ == "__main__":
    main()
