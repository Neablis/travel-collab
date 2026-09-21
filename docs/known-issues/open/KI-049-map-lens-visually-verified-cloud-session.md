### KI-49 — The Map lens cannot be visually verified in a cloud session: the egress proxy blocks the tile host
- **Severity:** process/verification (no user-facing defect; it removes a whole lens from local review)
- **Area:** `MapLens` / MapLibre's tile fetches to `tiles.openfreemap.org`; the Claude Code remote container's agent proxy.
- **Symptom:** in a cloud session the Map lens renders its **chrome** — day rail, focus card, legend, leg labels — over a **blank canvas**, because MapLibre's tile requests to `tiles.openfreemap.org` do not survive the container's egress proxy. Nothing errors visibly; the map simply has no basemap under it.
- **Why it matters more than it looks:** a blank canvas is easy to read as "the map is fine, the tiles are just slow", so a local pass on map work is not evidence and can be reported as one. The 2026-08-26 design audit covered every other route × lens × overlay at three widths and had to record the Map lens as **the one surface it could not look at**.
- **What this blocks:** any verification of map *rendering* — the day rail's restoration (design rule R2), leg geometry, marker placement, and anything about the basemap itself. Map **logic** is unaffected and stays testable: `mapRailData.ts` and friends are pure and unit-tested, which is where map assertions belong regardless.
- **Working practice until it changes:** verify map work on the **Vercel preview**, and say so explicitly. A local "looks fine" about the Map lens is not a claim anyone should accept, including from yourself — see `docs/guidelines/cloud-agent-sessions.md`.
- **Widened 2026-08-28 (M11's exit gate), and not in the direction anyone expected.** The gate ran from a laptop, not a cloud session, so this entry's proxy did not apply — and the map still could not be visually confirmed. On the preview's `/demo?lens=Map`: the tile **transport** verifies (the `positron` style, the `planet` tilejson, both sprite files and four glyph ranges all loaded from `tiles.openfreemap.org`; a same-context `fetch` of the style returned 200; WebGL is real — ANGLE / Apple M1 Max; the canvas is mounted at 1280x629). The **pixels** do not: the WebGL canvas comes back blank in the screenshot pipeline, and MapLibre requests its data tiles from a worker, whose fetches never appear in the main thread's `performance` resource timeline — so their absence from that list is not evidence in either direction.
- **The practical consequence:** "verify map work on the Vercel preview" is necessary but was **not sufficient** here. Neither environment has yet produced a picture of a rendered basemap. Whatever else changes, the rule this entry exists for is unchanged and now has a second supporting case: **a blank canvas is not a pass, and saying which half you verified — transport or pixels — is the whole point.**
- **MEASURED 2026-09-20, AND THE DIAGNOSIS IN THE TITLE IS WRONG.** *"The
  egress proxy blocks the tile host"* is not what happens. The host is
  reachable; the BROWSER does not trust the proxy's certificate.

  The evidence, in the order it settles the question:

  1. `curl https://tiles.openfreemap.org/styles/positron` → **HTTP 200** from
     inside the container. curl reads `HTTPS_PROXY` and the CA bundle, so this
     only shows the host is allowed — which is the part this entry got wrong.
  2. `curl "$HTTPS_PROXY/__agentproxy/status"` reports
     **`bundleCoversEveryHost: true`**, and its `recentRelayFailures` list
     contains 403 CONNECT denials for `…ingest.us.sentry.io` and **nothing for
     `tiles.openfreemap.org`**. A host the policy blocked would be in that list.
  3. A Playwright Chromium **top-level navigation** to the style URL (no CORS
     in play) fails with **`net::ERR_CERT_AUTHORITY_INVALID`**. That error is
     decisive on its own: it means the CONNECT SUCCEEDED and TLS was
     re-terminated by the proxy. A policy denial cannot produce a certificate
     error, because there is no certificate to reject.
  4. The proxy CA is `CN = CCR Upstream Proxy CA (staging), O = Anthropic`
     (`/root/.ccr/agent-proxy-ca.crt`). It is **absent** from the browser's NSS
     store at `$HOME/.pki/nssdb/cert9.db`, even though `/root/.ccr/README.md`
     lists "the browser NSS store" among the trust accommodations already set
     up. That claim did not hold in this session.

  **So the fix is a one-line trust install, not an egress policy change:**

      certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," \
        -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt

  (`certutil` comes from `libnss3-tools`, which is not in the image; `apt-get
  update && apt-get install -y libnss3-tools` fetched it.)

  **Not done here.** The command was refused by this session's permission
  classifier as a TLS-weakening action. That is a defensible default — it
  cannot tell "install the CA this proxy legitimately uses" from "make the
  browser stop checking certificates" — but it means the fix needs the user's
  say-so. **`--ignore-certificate-errors` and `ignoreHTTPSErrors: true` are NOT
  the alternative**: those disable verification, which the proxy README
  forbids outright, and they would make every future map "verification" in a
  cloud session meaningless in a way nobody would notice.

  **What this changes for anyone reading this entry:** the map is probably
  verifiable in a cloud session after all, and the 2026-08-28 laptop result
  (transport verified, pixels blank) is a SEPARATE problem that this does not
  explain or fix. Two causes were being read as one.

- **MEASURED AGAIN 2026-09-21, AND THE TITLE IS NOW FALSE AS WELL AS MISDIAGNOSED: the Map lens WAS visually verified in a cloud session.** A PR #200 preview walk rendered a real basemap — Portugal's coastline with Coimbra, Salamanca, Badajoz and Setúbal labelled, two markers (Lisbon, Porto), the dashed *by train or taxi* leg between them, and the `MapLibre | OpenFreeMap © OpenMapTiles` attribution. Confirmed by opening the screenshot, not by taking the walker's word for it. Both halves this entry separates — transport AND pixels — were readable for the first time.

  **Why it worked, and it is already in this repo:** the walk launched Chromium with `apps/web/scripts/walk-preview.mjs`'s recipe, whose header documents both container facts and fixes them — the gateway CAs pinned by **SPKI hash** (`--ignore-certificate-errors-spki-list`, computed from the certificates the environment itself installed, so it trusts exactly those five and is **not** `--ignore-certificate-errors`), plus `--ssl-version-max=tls1.2`, because `*.vercel.app` is tunnelled rather than inspected and the tunnel cannot carry Chromium's TLS 1.3 ClientHello once the post-quantum key share is in it.

  So the 2026-09-20 `certutil` fix is not the only route, and the one that worked needs no `apt-get`, no permission decision and no TLS weakening. **The working practice this entry has prescribed since 2026-08-26 — "verify map work on the Vercel preview, and a local *looks fine* is not evidence" — is now satisfiable from a container.**

- **CONSEQUENCE FOR THE E2E LANE, which is the actionable half and is NOT yet done.** `apps/web/playwright.config.ts` has **no `launchOptions` at all**, so the e2e lane's Chromium gets none of the above. That is why `e2e/m10-map-rail.spec.ts:52` and `e2e/m26-shared-day-map.spec.ts:73` both fail here with *"The map could not load"*, and it is why M26's Definition-of-Done gate box is ticked at 153 passed / 2 failed rather than green.

  **`KI-2026-09-20-c`'s line that `m10-map-rail` is "red in every cloud session regardless of how this entry is fixed, because the tiles still will not load" is therefore wrong**, and this is the evidence that retires it.

  **The fix is NOT simply copying the args into `playwright.config.ts`**, which is why this is written down rather than applied: the TLS 1.2 cap is a container workaround, and applying it unconditionally would silently stop CI exercising TLS 1.3 — the walk script says of itself that it "is not evidence about anything TLS-version-dependent". It needs to be conditional on the container, and *how* to detect that is a decision rather than a repair. Proposed, awaiting Mitchell.

- **Not yet investigated:** whether the tile host can be allowed through the proxy for cloud sessions; whether a locally-served offline tile fixture would be worth it for e2e; and, new as of the above, whether a screenshot pipeline that captures WebGL (`preserveDrawingBuffer`, or a headless Chromium screenshot taken outside this browser tooling) would close the pixels half from a laptop. None has been attempted; this entry exists so the choice is made deliberately rather than rediscovered by the next agent to touch the map.
- **First noted:** 2026-08-26 (design-sync UI audit; recorded after the audit shipped, PR #55 retrospective).
