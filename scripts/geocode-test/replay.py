"""Replay each way the provider can misbehave. Zero API calls.

Every mode is health-checked before the run, so an unreachable mock reports as
a harness fault instead of being silently recorded as a geocoder result — which
is exactly how the first version of this produced six meaningless rows.
"""
import subprocess, sqlite3, sys, time, os, signal, json, shutil, urllib.request
from pathlib import Path

H = Path(os.environ.get("GEO_HARNESS", "/tmp/geo-harness")); CACHE = H/"content/.geocode-cache.sqlite"
MODES = ["400", "dailycap", "persec", "500", "empty", "errbody", "ok"]

def fresh():
    for p in CACHE.parent.glob(".geocode-cache.sqlite*"): p.unlink()

def up(port):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/search?q=x", timeout=3).read()
        return True
    except urllib.error.HTTPError:
        return True                      # a 4xx/5xx still means it is listening
    except Exception:
        return False

# Build the isolated repo: five places, one bundle, its own cache.
REPO = Path(__file__).resolve().parent.parent.parent
H.mkdir(parents=True, exist_ok=True)
(H/"scripts").mkdir(exist_ok=True); (H/"content").mkdir(exist_ok=True)
shutil.copy(REPO/"scripts/geocode-content.py", H/"scripts/geocode-content.py")
json.dump({"$schema":"travel-collab/content-bundle/v1",
  "bundle":{"id":"t","name":"t","description":"t","origin":"ai","generatedAt":"2026-09-06"},
  "playbooks":[{"key":"k","title":"t","summary":"s","city":"Reykjavík","keptOn":"2026-09-01",
    "stops":[{"kind":"sight","name":f"S{i}",
              "location":{"name":f"Place {i}","area":"Area","city":"Reykjavík"}}
             for i in range(5)]}]}, open(H/"content/t.json","w"))

EXPECTED = {
    "400":      ("failed",    "http 400"),
    "dailycap": ("pending",   "daily quota reached"),
    "persec":   ("failed",    "still rate limited"),
    "500":      ("failed",    "http 500"),
    "empty":    ("not_found", "no result"),
    "errbody":  ("not_found", "no result"),
    "ok":       ("ok",        None),
}

rows = []
port = 8900
for mode in MODES:
    port += 1
    srv = subprocess.Popen([sys.executable, str(Path(__file__).parent / "fake_provider.py"), str(port), mode],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           preexec_fn=os.setsid)
    for _ in range(30):
        if up(port): break
        time.sleep(0.2)
    if not up(port):
        rows.append((mode, "HARNESS FAULT: mock never listened", "", "")); continue
    fresh()
    timed_out = ""
    try:
        subprocess.run([sys.executable, "scripts/geocode-content.py", "--url",
                        f"http://127.0.0.1:{port}/search", "--interval", "0.0",
                        "--max-transient-retries", "1", "--max-backoff", "1"],
                       cwd=H, timeout=30, capture_output=True)
    except subprocess.TimeoutExpired:
        timed_out = "  <-- LOOPS FOREVER"
    db = sqlite3.connect(CACHE)
    st = dict(db.execute("select status,count(*) from places group by 1"))
    nul = db.execute("select count(*) from places where status='failed' and last_error is null").fetchone()[0]
    ex = db.execute("select last_error from places limit 1").fetchone()
    db.close()
    rows.append((mode, str(st), f"failed+NULL={nul}", f"{str(ex[0] if ex else '')[:38]}{timed_out}"))
    try: os.killpg(os.getpgid(srv.pid), signal.SIGKILL)
    except Exception: pass

# Every command that READS the cache and reports or writes, run against the
# cache the last mode left behind. None of these were covered before, and a
# NameError in `--apply` — the command the whole script exists to end with —
# shipped green because the harness only ever exercised the geocoding loop.
print("\ncommands:")
for argv in (["--status"], ["--diagnose"], ["--review"],
             ["--apply", "--dry-run"], ["--apply", "--dry-run", "--include-city-level"],
             ["--retract", "--dry-run"]):
    r = subprocess.run([sys.executable, "scripts/geocode-content.py", *argv],
                       cwd=H, capture_output=True, text=True, timeout=60)
    label = " ".join(argv)
    if r.returncode != 0:
        tail = (r.stderr.strip().splitlines() or ["(no stderr)"])[-1]
        print(f"  {label:34} CRASHED — {tail}")
        rows.append((f"cmd {label}", "CRASHED", "", tail))
    else:
        print(f"  {label:34} ok")

bad = 0
print(f"\n{'mode':10} {'statuses':26} {'':16} reason")
for r in rows:
    print(f"{r[0]:10} {r[1]:26} {r[2]:16} {r[3]}")
    want_status, want_reason = EXPECTED.get(r[0], (None, None))
    if want_status and want_status not in r[1]:
        print(f"           ^ EXPECTED status {want_status!r}"); bad += 1
    elif want_reason and want_reason not in r[3]:
        print(f"           ^ EXPECTED reason containing {want_reason!r}"); bad += 1
    if r[1] == "CRASHED":
        bad += 1
        continue
    if "failed+NULL=0" not in r[2]:
        print("           ^ a failure was recorded with NO reason"); bad += 1
print(f"\n{'FAILURES: %d' % bad if bad else 'all modes behaved as expected'}")
sys.exit(1 if bad else 0)
