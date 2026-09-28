# Landing retro — 2026-09-28 (copy pass)

Mitchell's retro on the front door, sent as copy rather than as an artboard.
Recorded here because the design file (`Trip Planner Redesign.dc.html`) still
carries the previous words, and `.design-sync/handoff/DRIFT.md` D21 points here.

> Same page, new temperature. Night before the trip feeling.
>
> What changed from the last pass: the old version sold the mechanics of
> playbooks. This one sells the feeling and lets the mechanics ride along.
> Nobody reads "real days from real trips, saved by the people who lived them"
> and thinks software. They think of their own photos, which is exactly where
> you want them.

## The copy, as built

| Surface | Copy |
| --- | --- |
| Nav | Unchanged |
| Hero kicker | DAYS WORTH RELIVING |
| Hero headline | Put the best day on repeat. |
| Hero sub | Caesura is a trip planner built on playbooks: real days from real trips, saved by the people who lived them. Borrow a perfect day in Kyoto, plan the rest with your group, and relive it all when you're home. |
| Hero buttons | Start a trip / Look around a real trip |
| Hero microcopy | Free during early access. Invite the group with a link, nothing to install. |
| Hero art | Kyoto map kept; a "can't wait" heart on pin 1 (Fushimi Inari) |
| Playbooks | *Relive someone's perfect day.* — Every playbook is a day that actually happened, saved by the person who lived it, in the order it happened. The sunrise, the alley, the swim. Drop it into your trip and it's yours now. Phuket card kept; metric now "Relived 214 times". |
| Together | *The trip starts before the trip.* — One plan your whole group can touch. Drag a stop and watch everyone react. Tap the ones you can't wait for. Argue about Pontocho now, thank yourselves in Kyoto. (Fushimi Inari carries ♥ 3.) |
| Countdown (new) | *Too excited to sleep.* — Every trip gets a living countdown, shared with the whole group. One month. One week. Wheels up tomorrow. Sleep if you can. |
| Notebook | *How you'll remember it.* — Pages that read like the letter home, with times and costs pulled live from the plan. Before the trip it's a promise. After, it's the keepsake. |
| Final CTA | *Start the plan, then send the link.* — A trip takes about a minute to set up. Everything after that is easier with company. Under the buttons: Free during early access. |
| Footer | © 2026 Caesura · Privacy · Terms · mitchell@demarcosoftware.com |

## Build-side calls made while applying it

- **Countdown has no artboard.** The card is built from the other blocks'
  parts: a header row (trip, date, crew), a large "1 · day to go · Wheels up
  tomorrow.", a three-step track (One month ✓, One week ✓, Tomorrow), and
  Priya's 1:12 am message. A fixture frozen the night before — never a clock
  read, per SPEC §14.
- **The grid is two columns from `lg`,** not four: four across would crush the
  Playbooks card's borrowed Day 2 (see `LandingFeatureBlocks.tsx`).
- **"Planning is the trip, three times over." is gone.** The retro gives each
  block a heading of its own, so those became the section `<h2>`s.
- **"Free" is back only as the early-access footnote.** SPEC §14 banned the
  word; the retro reopens it for this one line. The unit guard now allows
  "Free during early access" and nothing else, and matches per element — the
  old `container.textContent` form could not see a "Free" that followed
  another element's text.
- **Privacy and Terms are plain text,** not links: neither page exists yet.
- **The phone front door follows the same story.** Its four claims are now
  Playbooks, Together, Countdown, Notebook (the card-less "One plan" opener
  went), with the same headline, kicker, closing CTA and footnote.
- **The OG card and site description** carry the new headline
  (`scripts/generate-og-assets.mjs`, re-run).
