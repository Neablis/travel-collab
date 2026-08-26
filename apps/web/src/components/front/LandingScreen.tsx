import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { DataText } from "@/components/ui/data-text";
import { Preview } from "@/components/ui/preview";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { cn } from "@/lib/cn";

// Every string here is transcribed from the design source
// `.design-sync/handoff/design/Trip Planner Redesign.dc.html:1486-1541` and
// `:3412-3419`. The hero's second sentence sells fork/remix (M11) and
// community (M12), neither of which is built: Mitchell approved shipping it
// as aspiration on 2026-08-26 (docs/milestones/M15-front-door.md, open
// question 2). Do not trim it back without a new decision recorded there.
const STOPS = [
  { time: "9:40 am", title: "Fushimi Inari, early", meta: "Priya · before the crowds", badge: null },
  { time: "1:15 pm", title: "Lunch at Nishiki Market", meta: "Everyone · 45 min walk after", badge: { label: "Idea", variant: "neutral" } },
  { time: "4:00 pm", title: "Ryokan check-in, Higashiyama", meta: "Everyone · $340", badge: { label: "Booked", variant: "success" } },
] as const;

const PROOF_CHIPS = ["Four people, one plan", "Costs as you go", "Remix anyone's itinerary"] as const;

const CREW = ["PS", "SK", "MJ", "AL"] as const;

export function LandingScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/signin" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Sign in
            </Link>
            <Link href="/signup" className={cn(buttonVariants({ variant: "primary", size: "sm" }), "no-underline")}>
              Start a trip
            </Link>
          </>
        }
      />

      <main className="grid flex-1 place-items-center px-7 pt-6 pb-18">
        <div className="grid w-full max-w-285 items-center gap-15 lg:grid-cols-2">
          <div className="flex flex-col gap-5.5">
            <DataText size="xs" className="tracking-[0.11em] uppercase">The open-source itinerary</DataText>

            <Heading level={1} className="text-pretty">
              Plan the trip together, not in twelve group chats.
            </Heading>

            <Text as="p" variant="secondary" className="max-w-[30em] text-pretty">
              Everyone on the trip can edit the same plan — days, times, costs, who&apos;s in. Save the
              highlights when you get back, share them with the world, and let other travelers remix the
              best parts into their own adventures.
            </Text>

            <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
              <Link href="/signup" className={cn(buttonVariants({ variant: "primary" }), "no-underline")}>
                Continue with Google
              </Link>
              {/* M11 owns unauthenticated read of a real trip (share links).
                  Shipping the button as a Preview shell keeps the design's
                  shape and is honest about it — M15's gate requires exactly
                  this, and forbids building a bespoke public-read path. */}
              <Preview id="landing-peek-trip" size="compact">
                <Button type="button" variant="secondary">
                  Look around a real trip
                </Button>
              </Preview>
            </div>

            <Text as="p" variant="secondary" className="text-xs">
              Free and open source · No credit card · Your itineraries export as plain files
            </Text>
          </div>

          <div className="flex flex-col gap-3">
            <Card raised className="overflow-hidden p-0">
              <div className="flex items-center gap-2.5 border-b border-hairline bg-moss px-4 py-3">
                <DataText size="xs" className="tracking-[0.08em] uppercase">Day 6 · Kyoto</DataText>
                <div className="ml-auto flex">
                  {CREW.map((initials) => (
                    <span
                      key={initials}
                      className="-ml-1.5 grid size-6 place-items-center rounded-full border-2 border-surface bg-brand-tint text-[9.5px] font-semibold text-brand-pressed"
                    >
                      {initials}
                    </span>
                  ))}
                </div>
              </div>

              <div className="px-4 pt-1.5 pb-3.5">
                {STOPS.map((stop) => (
                  <div key={stop.title} className="grid grid-cols-[74px_1fr] gap-3.5 border-b border-hairline py-2.5">
                    <DataText size="xs" className="pt-0.5">{stop.time}</DataText>
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text as="span" className="font-semibold">{stop.title}</Text>
                        {stop.badge ? <Badge variant={stop.badge.variant}>{stop.badge.label}</Badge> : null}
                      </div>
                      <Text as="span" variant="muted">{stop.meta}</Text>
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-3">
                  <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                  <Text variant="secondary" className="text-xs">
                    Priya is moving the ryokan check-in right now
                  </Text>
                </div>
              </div>
            </Card>

            <div className="flex flex-wrap gap-2">
              {PROOF_CHIPS.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs text-slate"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
