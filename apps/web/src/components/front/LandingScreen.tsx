import Link from "next/link";
import { Heading } from "@/components/ui/heading";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";

export function LandingScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/signin" className="px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
              Sign in
            </Link>
            <Link href="/signup" className="px-2.5 py-1.5 text-base font-medium text-slate no-underline hover:text-ink">
              Start a trip
            </Link>
          </>
        }
      />
      <main className="flex flex-1 items-center justify-center px-7 pb-18">
        <Heading level={1}>Plan the trip together, not in twelve group chats.</Heading>
      </main>
    </div>
  );
}
