"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { rememberPlaybookAdd } from "@/lib/pendingPlaybookAdd";

/**
 * What *Add to a trip* opens for a reader with no account (ADR-061).
 *
 * The button is shown to them rather than hidden, the share page's shape
 * (`SharedTripScreen`): adding the day is the thing a stranger opening a shared
 * link is most likely to want, and a page that hid it would never tell them it
 * exists. Both ways in come back to this day, and both bank the intent first
 * (`lib/pendingPlaybookAdd.ts`), so the day's page opens the add dialog on the
 * way back instead of making them find the button again.
 */
export function SignInToAddDialog({
  open,
  onOpenChange,
  savedDayId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedDayId: string;
}) {
  const back = encodeURIComponent(`/playbooks/day/${savedDayId}`);
  // Banked on the click, not when the dialog opens: opening it and closing it
  // again is not a request to add anything when they next sign in.
  const bank = () => rememberPlaybookAdd(savedDayId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Sign in to add this day">
      <Text variant="secondary">
        An account lets you drop this day into a trip of your own, then move its stops around and plan the rest
        of the trip around it.
      </Text>
      <DialogFooter>
        <Link
          href={`/signin?callbackUrl=${back}`}
          onClick={bank}
          className={cn(buttonVariants({ variant: "secondary" }), "no-underline")}
        >
          Sign in
        </Link>
        <Link
          href={`/signup?callbackUrl=${back}`}
          onClick={bank}
          className={cn(buttonVariants({ variant: "primary" }), "no-underline")}
        >
          Create an account
        </Link>
      </DialogFooter>
    </Dialog>
  );
}
