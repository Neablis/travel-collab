"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { useReferralLink } from "./useReferralLink";

/**
 * **"Bring someone in, get a month", where people already bring people in**
 * (M50 decision 8): the Share panel and the Invite dialog. Renders nothing for
 * an account that would earn nothing, so a free or trial account sees no
 * change. Mount it only while its dialog is open: it reads on mount.
 */
export function ReferralNudge({ className }: { className?: string }) {
  const referral = useReferralLink();
  if (!referral.earns) return null;

  return (
    <div className={cn("flex flex-col gap-1.5 border-t border-hairline pt-3", className)} data-testid="referral-nudge">
      <div className="flex items-center justify-between gap-2">
        <Text as="span" className="text-xs text-ink">
          Bring someone in, get a month
        </Text>
        <Button variant="ghost" size="sm" aria-label="Copy referral link" onClick={() => void referral.copy()}>
          {referral.status === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>
      {referral.status === "denied" && referral.link !== null ? (
        <Input readOnly aria-label="Referral link" value={referral.link} onFocus={(e) => e.target.select()} />
      ) : null}
      {/* Mounted before it has anything to say, so a screen reader announces
          what lands in it: the button's name does not change on failure. */}
      <div role="status">
        {referral.status === "full" ? (
          <Text as="span" className="text-xs text-slate">
            You hold as many unused codes as you can. They are under{" "}
            <Link href="/account?tab=plan" className="underline">
              Account, Plan
            </Link>
            .
          </Text>
        ) : null}
        {referral.status === "failed" ? (
          <Text as="span" className="text-xs text-danger-ink">
            Couldn&apos;t make a link just now.
          </Text>
        ) : null}
      </div>
    </div>
  );
}
