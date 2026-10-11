import Link from "next/link";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { buttonVariants, PHONE_TOUCH } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { demoPath, type DemoTripCard } from "@/lib/demoTrip";

/**
 * `/demo`: the example trips a visitor with no account can open (M42 D1), each
 * with what kind of trip it is (D8) and how long. Every card opens that trip's
 * real board at `/demo/<slug>`.
 */
export function DemoPicker({ cards }: { cards: readonly DemoTripCard[] }) {
  return (
    <>
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
      <PageContainer as="main" className="flex flex-col gap-5 pb-12">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Look around a real trip</Heading>
          <Text variant="secondary">
            Each one is the real board with the changes turned off. Pick one, and take a copy if you like it.
          </Text>
        </div>
        <ul aria-label="Example trips" className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <DemoCard key={card.slug} card={card} />
          ))}
        </ul>
      </PageContainer>
    </>
  );
}

function DemoCard({ card }: { card: DemoTripCard }) {
  const descriptionId = `demo-${card.slug}-description`;
  return (
    <Card as="li" className="flex flex-col gap-1">
      <Link
        href={demoPath(card.slug)}
        className={cn("inline-flex items-center hover:underline", PHONE_TOUCH)}
        // On the link, where focus lands, so the kind of trip is heard with its name.
        aria-describedby={card.description === null ? undefined : descriptionId}
      >
        <Heading level={2} className="text-lg">
          {card.name}
        </Heading>
      </Link>
      {card.description !== null && (
        <Text variant="secondary" id={descriptionId}>
          {card.description}
        </Text>
      )}
      <DataText size="sm">{card.dayCount === 1 ? "1 day" : `${card.dayCount} days`}</DataText>
    </Card>
  );
}
