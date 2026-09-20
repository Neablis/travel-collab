"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { UnderlineTabs, tabId, tabPanelId } from "@/components/ui/underline-tabs";
import { SETTINGS_MEASURE } from "@/components/ui/settings-card";
import { useSessionUser } from "./useSessionUser";
import { ProfileSection } from "./ProfileSection";
import { PlanSection } from "./PlanSection";
import { TokensSection } from "./TokensSection";

// SPEC §34.4 — Account is a page with tabs, not a Sheet.
//
// The sheet had reached six unrelated things in one scroll — plan, usage
// meters, referrals, identity, display preferences and then tokens — and the
// next thing added would have gone to the bottom for want of anywhere better.
// Mitchell filed the same complaint independently as `KI-2026-09-17-a`.
//
// **The tab is the route** (DRIFT §6 build-check 4), so the selection lives in
// `?tab=` and not in component state. That is what makes each tab a URL the
// back button walks, a link somebody can send, and the target `/plans` returns
// to (`?tab=plan`). Component state would give none of the three.
//
// **A tab's label is the section's heading.** `PlanSection` and `TokensSection`
// dropped their own `<Heading>` and the `aria-labelledby` that pointed at it
// when they moved here: the tab panel does the labelling now, and keeping both
// is project rule 4 twice on one screen.
const TABS = [
  { value: "profile", label: "Profile" },
  { value: "plan", label: "Plan & usage" },
  { value: "tokens", label: "API tokens" },
] as const;

type AccountTab = (typeof TABS)[number]["value"];

const ID_PREFIX = "account";

/**
 * Which tab a query parameter names.
 *
 * Anything unrecognised — absent, misspelt, or an old link from before a tab
 * was renamed — resolves to Profile rather than rendering an empty page. A
 * settings URL someone bookmarked should not be able to rot into a blank
 * screen.
 */
export function accountTabFrom(raw: string | null): AccountTab {
  return TABS.some((t) => t.value === raw) ? (raw as AccountTab) : "profile";
}

export function AccountScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useSessionUser();
  const tab = accountTabFrom(searchParams.get("tab"));

  return (
    <PageContainer width="content">
      <div className="flex flex-col gap-5 pt-1 pb-20">
        {/* **The phone's way out** (SPEC §34.3: *"Done returns you to Trips"*).
            Account is a TASK on a phone — the tab bar steps aside for it
            (`taskOwnsScreen`) — so without this the only way back is the
            browser's own gesture, on the one surface that has just removed the
            app's navigation. `md:hidden`, because a desktop still has the
            header above it.

            A `Link`, not a `router.back()`: §34.3 names the destination, and
            "back" from a bookmarked `/account` leaves the app. */}
        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "ghost", size: "touch" }),
            "-ml-3.5 self-start no-underline md:hidden",
          )}
          data-testid="account-done"
        >
          &lsaquo; Trips
        </Link>

        <div className="flex flex-col gap-1.5">
          <Heading level={1}>Account</Heading>
          <Text variant="secondary" className="max-w-155 text-pretty">
            Everything true of you across every trip. Anything that belongs to one trip — who is
            invited, its budget, its dates — lives in that trip&rsquo;s own settings.
          </Text>
        </div>

        <UnderlineTabs
          value={tab}
          onValueChange={(next) => {
            // `push`, not `replace`: the gate asks for a URL the browser back
            // button walks, and `replace` would make the tabs a dead end you
            // can only leave by going back past the whole visit.
            router.push(next === "profile" ? "/account" : `/account?tab=${next}`);
          }}
          options={TABS}
          idPrefix={ID_PREFIX}
          aria-label="Account sections"
        />

        {/* One mounted panel, not three hidden ones. `PlanSection` and
            `TokensSection` both self-fetch on mount, so rendering all three
            would fire every request on arrival to show one of them — and the
            token list is the one surface here whose contents are credentials.
            The cost is a fetch per tab visit, which is what a route is. */}
        {/* **The 580px measure is the panel's, not each section's** (§34.5:
            *"every panel on Account sits on a 580px measure"*; the artboard
            puts it on each tab's content div). One place, so a fourth tab
            cannot arrive a little wider than the other three. */}
        <div
          role="tabpanel"
          id={tabPanelId(ID_PREFIX, tab)}
          aria-labelledby={tabId(ID_PREFIX, tab)}
          tabIndex={-1}
          className={SETTINGS_MEASURE}
        >
          {tab === "profile" && <ProfileSection email={user?.email ?? ""} />}
          {tab === "plan" && <PlanSection />}
          {tab === "tokens" && <TokensSection />}
        </div>

        {/* **Sign out, on the phone only, below the tabs** — and this is the
            half of link 1's decision that lands here. §34.4's *"Sign out sits
            below [the tabs]"* is about THIS screen: a phone has no avatar
            popover to hold it, because §34.3 makes this a task the tab bar
            steps aside for. A desktop does have one, and putting it in both
            would be project rule 4 twice on one account — so `md:hidden`, and
            the desktop `/account` artboard has no sign-out either.

            `/welcome`, not `/` — the same race `AccountMenu` documents:
            `signOut` sets `window.location.href` after POSTing, and pointed at
            `/` the navigation can outrun the Set-Cookie that clears the
            session. `/welcome` is public, so it is correct whether the cookie
            has landed or not. */}
        <div className="border-t border-hairline pt-4 md:hidden">
          <Button
            variant="secondary"
            size="touch"
            data-testid="account-sign-out"
            onClick={() => void signOut({ callbackUrl: "/welcome" })}
          >
            Sign out
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
