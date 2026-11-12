# Move the Coolify box from Hetzner Ashburn to OVHcloud Hillsboro

**Status:** planned 2026-11-09, not started. Follows M59 (`docs/milestones/M59-self-host-on-coolify-vps.md`);
the runbook it changes is `docs/ops/coolify-vps.md`. **Ends at V7:** once `caesura-1` is deleted
and the runbook names the OVHcloud box, delete this plan. The region reasoning below is the durable
part, so move it into the runbook first.

## Why

M59's target was about $20/mo for the box. O2 created it as "the 8GB box, nearest region to
the audience" and nobody priced the region. Read from the Hetzner API on 2026-11-09:

| Hetzner type | Spec | Ashburn / Hillsboro (US) | Nuremberg / Falkenstein / Helsinki (EU) |
|---|---|---|---|
| `cpx31` (what `caesura-1` is) | 4 vCPU, 8 GB, 160 GB | **73.49/mo**, 3.3 TB traffic | 20.49/mo, 22 TB |
| `ccx13` | 2 dedicated vCPU, 8 GB | 50.99 | — |
| `cpx21` | 3 vCPU, 4 GB | 37.49 | 10.99 |

Hetzner's US regions cost about 3.5x its EU ones. There is no 8 GB Hetzner box in the US
under about 51/mo.

**Where the database is decides the region.** Neon project `sweet-firefly-79114130` is in
`aws-us-west-2` (Oregon). Every page makes several sequential queries, so the box belongs
next to Oregon:

- Ashburn → Oregon is about 65 ms round trip per query (today).
- Germany → Oregon is about 150 ms round trip per query. That rules out Hetzner EU, even as a
  stopgap.
- Hillsboro, OR → Oregon is a few ms.

## The pick

**OVHcloud VPS-2 in Hillsboro, OR**: 4 vCPU, 8 GB, 75 GB NVMe, x86, unlimited traffic,
about $10/mo, billed monthly (no hourly). Picked by Mitchell 2026-11-09 over Netcup Manassas, which
has similar pricing but needs a 12–24 month term for the best price and is on the east coast.
Its first pick was Vint Hill, VA; Hillsboro replaces it once the Neon region was read. OVHcloud
sells both at the same price.

The price is from third-party comparison sites (vpsinsider, vpsbenchmarks, Valebyte, Sep–Nov
2026), not OVHcloud's own page. **Read the checkout total before paying.**

What changes for the operator: no `hcloud`-style resize from the session, monthly rather than
hourly billing, and the OVHcloud control panel and API instead of Hetzner's. The disk is
75 GB rather than 160 GB, which is enough for Coolify, the images it keeps, Redis and Plausible;
`docker system prune` is the lever if it fills.

## Steps

The same shape as M59's O2–O6. Env values never enter the repo, a PR, a log or the chat.

| Step | Who | What | Done when |
|---|---|---|---|
| V1 | **Mitchell** | Order OVHcloud VPS-2, Hillsboro, plain Ubuntu 24.04, no backup add-on, with the `caesura-vps` public key (`~/.ssh/caesura_vps.pub`, the key `caesura-1` uses). Send the IPv4 address. | `ssh` with that key answers |
| V2 | agent | Firewall 22/80/443/8000 (`ufw`, plus OVHcloud's network firewall if on), install Coolify with the official script, concurrent builds 1 | dashboard answers on `:8000` |
| V3 | **Mitchell** | Coolify admin account; add the new instance to Coolify's GitHub App on the repo; a Coolify API token for the session | token works |
| V4 | agent | Recreate `caesura-web` from the Dockerfile with the production env copied by name from the old Coolify (drop the three in KI-2026-11-09-b); Redis + serverless-redis-http and Plausible as services (Plausible data from its scheduled backup); PR previews on `*.preview.`; both scheduled tasks | the app serves on the new box's IP with a test Host header, both crons fired once by hand |
| V5 | agent | Point `staging.` at the new box and walk it: Google sign-in, open a trip, ask the assistant, a pageview in Plausible | walk passes |
| V6 | agent, on Mitchell's go | Flip apex, `www`, `coolify.`, `plausible.` and `*.preview.` A records in Cloudflare to the new IP (DNS-only, grey cloud, unchanged); walk `caesura.today` | production serves from OVHcloud |
| V7 | agent, on Mitchell's OK | After a day with no rollback, delete `caesura-1`, its primary IPs and the `caesura-web` Hetzner firewall; update `docs/ops/coolify-vps.md` (provider, location, monthly cost) | Hetzner shows no servers |

**Rollback until V7:** point the Cloudflare records back at `caesura-1`'s IP. The old box keeps
running unchanged until then.

**Cost of the overlap:** `caesura-1` bills about 0.10/hour until V7, so a day of overlap
is about 2.50.

## Not doing in the meantime

Moving `caesura-1` to Hetzner EU tonight was sized and rejected 2026-11-09:

- Hetzner can't move a server between locations. It would take a snapshot, a new server
  from it in Nuremberg, a new IP and a DNS flip. That's about an hour of work and a second cutover
  a few days before this one.
- It saves 73.49 → 20.49, about 1.75/day, so roughly 10–15 before V6.
- It makes every query about 2.3x slower (Germany → Oregon), for every user, until V6.
- Resizing in place to something cheaper in Ashburn doesn't work either: `caesura-1` was
  created as a `cpx31` with a 160 GB disk, and Hetzner won't shrink a disk. The cheaper
  `cpx21` has an 80 GB disk.
