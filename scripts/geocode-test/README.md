# Offline replay for the content geocoder

`replay.py` runs `scripts/geocode-content.py` against a fake provider that
answers the way LocationIQ actually misbehaves, in an isolated five-place repo
under `$GEO_HARNESS` (default `/tmp/geo-harness`). **It makes no network calls
and spends no quota**, and it asserts the expected status and reason for every
mode, exiting non-zero when one is wrong.

    python3 scripts/geocode-test/replay.py

Run it after ANY change to the geocoder, before asking a person to spend twenty
minutes and several hundred API calls finding out. That sequence happened three
times, and the last of those runs was a silent no-op whose cause this harness
located in seconds:

| mode | what the provider does | expected |
| --- | --- | --- |
| `400` | HTTP 400 | `failed`, reason `http 400` |
| `dailycap` | 429 naming the daily quota | stays `pending`, reason recorded, run stops |
| `persec` | 429 on every request | `failed` after bounded waits — **must not hang** |
| `500` | HTTP 500 | `failed`, reason `http 500` |
| `empty` | `[]` | `not_found`, reason `no result` |
| `errbody` | 200 with an error body | `not_found`, reason `no result` |
| `ok` | a good result | `ok` |

Every mode also asserts that no row is ever recorded as `failed` with a NULL
reason — the state that made a whole run unexplainable after the fact.

To add a mode, add a response to `fake_provider.py` and its expectation to
`EXPECTED` in `replay.py`. A mode without an expectation is not a test.
