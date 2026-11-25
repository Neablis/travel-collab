### KI-2026-11-14-d — every PR got a running Coolify preview, and fifteen of them ran the 8 GB box out of memory: caesura.today was down for over an hour

- **Severity:** correctness of production (an outage), now gated; stays open until the gate is
  live on the box.
- **Area:** Coolify `caesura-web` → Configuration → *Preview Deployments* (the switch), the
  repository's `COOLIFY_API_TOKEN` secret and `COOLIFY_APP_UUID` variable,
  `.github/workflows/coolify-preview.yml`, `scripts/coolify-preview.mjs`,
  `.github/workflows/preview-link-check.yml`; the box `caesura-1` (Hetzner `cpx31`, 4 vCPU, 8 GB, no swap).
- **Symptom / What happens:** on 2026-11-14 the overnight KI sweep opened fifteen PRs (735–749),
  and Coolify built and kept running a preview of each. Ten of them merged within three minutes
  (14:26–14:29 UTC), each starting a production build of about 4 GB. From about 15:00 UTC the
  box stopped answering anything, the dashboard included: TLS handshakes to `caesura.today`
  and `coolify.caesura.today` hung, while Hetzner reported the server `running`. Its metrics
  showed all four cores pinned (~400% CPU) and ~1.5 GB/s of disk reads with almost no network
  traffic, from 15:00 to 16:15: memory exhaustion without swap, the kernel re-reading evicted
  program pages instead of serving. A hard reset through the Hetzner API at 16:15 brought
  production back on `32867da` within a minute. The earlier failed preview build of PR 742
  (08:35 UTC) was likely the same pressure.
- **Cause:** M59 part 5 (`8f0517d`) deleted the `vercel-preview` workflow and its `preview`
  label, reasoning that the box has a fixed price, and switched Coolify's *Preview Deployments*
  on. The cost of a preview on the box is memory, not money: each one keeps a container
  running beside production, Redis and Plausible, and a production build needs about 4 GB.
- **Fix (the branch that files this entry):** the `preview` label is back as the only way to get
  a preview. `coolify-preview.yml` opens one through Coolify's API
  (`POST /api/v1/applications/{uuid}/previews`, Coolify ≥ 4.4.0) when the label is added,
  rebuilds it on each push while labelled, and removes it (`DELETE …/previews/{pr}`) when the
  label comes off or the PR closes; `preview-link-check` runs only on labelled PRs. Agents and
  skills label only the PR being walked and unlabel it after. One preview at a time: two up
  at once still crashed the box, so labelling a PR first removes every other labelled PR's
  preview and takes their label off.
- **Still to do, on the box (Mitchell), before this closes:**
  1. Switch *Preview Deployments* **off** on `caesura-web`.
  2. Create a Coolify API token with `write`, `deploy` and `delete`, and save it as the
     repository's `COOLIFY_API_TOKEN` Actions secret; save the application's uuid as the
     `COOLIFY_APP_UUID` Actions variable.
  3. Label one open PR `preview` and confirm its preview builds, then unlabel it and confirm
     the preview is removed.
  4. Label two PRs one after the other and confirm the first's preview is removed and its
     label taken off.
- **Not done, worth deciding:** swap on the box (a few GB would turn the next exhaustion into
  slowness rather than an outage); a memory limit on preview containers; the planned move to
  a larger, cheaper box (M64 (`docs/milestones/M64-one-cheap-box-own-postgres.md`, which replaced the 2026-11-09 OVHcloud plan)). And a batch of
  merges still starts one production build each, queued one at a time.
- **Tripwire:** caesura.today or the Coolify dashboard stops answering while Hetzner says the
  server is running; or more than one preview container up at once.
- **Cross-reference:** `docs/guidelines/environments-and-deploys.md` (*Which pushes build a
  preview*), `docs/ops/coolify-vps.md` (*Previews*), M59 part 5 (`8f0517d`).
- **First noted:** 2026-11-14, reported by Mitchell ("I think caesura.today is down after those
  merges"); diagnosed from Hetzner's metrics API.
