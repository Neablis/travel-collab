"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { forgetAskConversationsOf } from "@/lib/askOwnership";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants, PHONE_TOUCH } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { UnderlineTabs, tabId, tabPanelId } from "@/components/ui/underline-tabs";
import { SETTINGS_MEASURE } from "@/components/ui/settings-card";
import { useSessionUser } from "./useSessionUser";
import { ProfileSection } from "./ProfileSection";
import { PlanSection } from "./PlanSection";
import { TokensSection } from "./TokensSection";
import { ConnectedAppsSection } from "./ConnectedAppsSection";
import { Text } from "@/components/ui/text";
import type { AccountPlanChoice, AccountPlanState } from "@/lib/accountPlan";
import { HOME_PATH } from "@/lib/homePath";
import { clearSignedInHint } from "@/lib/sessionHint";

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
// **A tab's label is the section's heading.** `PlanSection` dropped its own
// `<Heading>` and the `aria-labelledby` that pointed at it when it moved here:
// the tab panel does the labelling now, and keeping both is project rule 4
// twice on one screen.
//
// **Security holds API tokens and Connected apps** (M55 part 6). They were
// sub-views reached by quiet links at the foot of Profile (SPEC §35.4, M27
// D7; M55 D10), and Mitchell found them buried there. The tab is the place
// for whatever else secures an account later (MFA), beside `PremiumSecurity`
// rather than inside it.
const TABS = [
  { value: "profile", label: "Profile" },
  { value: "plan", label: "Plan & usage" },
  { value: "security", label: "Security" },
] as const;
type AccountTab = (typeof TABS)[number]["value"];

/**
 * One of Security's sections under its heading.
 *
 * The heading lives here rather than inside the section, which renders nothing
 * until its fetches resolve: `aria-labelledby` has to name something that
 * exists from the first paint. h2 under the page's h1 (axe heading-order);
 * `text-lg` is the size these headings had as sub-views.
 */
function SecuritySection({ heading, headingId, children }: { heading: string; headingId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <Heading level={2} id={headingId} className="text-lg">
        {heading}
      </Heading>
      {children}
    </section>
  );
}

/**
 * Security's Premium half: API tokens and Connected apps, both gated on
 * `api.tokens` (minting a token, and consenting to an app, D6).
 *
 * **One upgrade prompt over both, not one per section** (Mitchell, M55 part
 * 6): only the tokens section used to say it, so Connected apps read as free
 * until the consent screen refused. Both sections still render beneath it, so
 * a free account sees what it would get, and only creating is withheld: a
 * lapsed account keeps Revoke and Disconnect, because cutting off a credential
 * must never cost a subscription.
 *
 * `role="status"` from `Banner`, polite and not an alert: it is the page's
 * standing state, not news.
 */
function PremiumSecurity() {
  // `null` until the plan lands, and if it never does: no prompt, and no New
  // token, while the lists and their removal carry on regardless.
  const [plan, setPlan] = useState<{ entitled: boolean; lapsed: boolean } | null>(null);
  // Said under the tokens heading, or New token would vanish with no reason.
  const [planFailed, setPlanFailed] = useState(false);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    fetch("/api/account/plan")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!live) return;
        if (body === null) {
          setPlanFailed(true);
          return;
        }
        const read = (
          body as {
            plan: {
              entitlements: readonly string[];
              billing?: { state: AccountPlanState };
              catalogue?: readonly AccountPlanChoice[];
            };
          }
        ).plan;
        // `billing` read defensively: a body without it once took the whole
        // token list down for the sake of one sentence of copy.
        //
        // **Lapsed from the API only if the held plan carried it.** Any
        // subscription that stops conferring reads `lapsed`, and only Premium
        // has `api.tokens`: a lapsed Plus account never had either, and
        // restarting Plus turns neither on. The catalogue keeps the bought plan
        // `held` through a lapse.
        const lapsed =
          read.billing?.state === "lapsed" &&
          (read.catalogue?.some((choice) => choice.held && choice.entitlements.includes("api.tokens")) ?? false);
        setPlan({ entitled: read.entitlements.includes("api.tokens"), lapsed });
      })
      .catch(() => {
        if (live) setPlanFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {plan !== null && !plan.entitled ? (
        <Banner variant="info" data-testid="security-upgrade">
          {/* **Lapsed is not never-subscribed** (`accountPlan.ts`): "restart"
              and "subscribe" are different acts and different sentences.
              **And taking your trips with you is not Premium** (§34.1), said
              here because "not on this plan" beside your own data reads as
              a threat to it. */}
          {plan.lapsed
            ? "Your Premium subscription has ended, so API tokens and connected apps are off. Restarting it turns them back on — nothing was deleted."
            : "API tokens and connecting apps like Claude are on the Premium plan. Downloading a trip as a file is not — that is on every plan, from Trip settings."}{" "}
          <Link
            href="/plans"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            data-testid="security-upgrade-link"
          >
            {plan.lapsed ? "Restart it" : "See plans"}
          </Link>
        </Banner>
      ) : null}
      <div className="flex flex-col gap-10">
        <SecuritySection heading="API tokens" headingId="account-tokens-heading">
          {planFailed ? (
            <Text variant="secondary" className="text-sm" data-testid="security-plan-failed">
              Your plan could not be checked just now, so creating a token is unavailable. Reload to try again.
            </Text>
          ) : null}
          <TokensSection entitled={plan?.entitled ?? null} />
        </SecuritySection>
        <SecuritySection heading="Connected apps" headingId="account-apps-heading">
          <ConnectedAppsSection />
        </SecuritySection>
      </div>
    </div>
  );
}

/** The sub-view URLs from before Security, kept so their links and bookmarks still land. */
const MOVED_TO_SECURITY = ["tokens", "apps"];

const ID_PREFIX = "account";

/**
 * Which tab a query parameter names.
 *
 * Anything unrecognised — absent, misspelt, or an old link from before a tab
 * was renamed — resolves to Profile rather than rendering an empty page. A
 * settings URL someone bookmarked should not be able to rot into a blank
 * screen. The old `?tab=tokens` and `?tab=apps` resolve to Security, which
 * holds what they showed.
 */
export function accountTabFrom(raw: string | null): AccountTab {
  if (raw !== null && MOVED_TO_SECURITY.includes(raw)) return "security";
  return TABS.find((t) => t.value === raw)?.value ?? "profile";
}

export function AccountScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useSessionUser();
  const tab = accountTabFrom(searchParams.get("tab"));

  return (
    <PageContainer as="main" width="content">
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
          href={HOME_PATH}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            PHONE_TOUCH,
            "-ml-3.5 self-start no-underline md:hidden",
          )}
          data-testid="account-done"
        >
          &lsaquo; Trips
        </Link>

        {/* No explanatory paragraph under the heading (SPEC §35.4). */}
        <Heading level={1}>Account</Heading>

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
          hasPanel
          aria-label="Account sections"
        />

        {/* One mounted panel, not three hidden ones. `PlanSection` and
            `TokensSection` both self-fetch on mount, so rendering all three
            would fire every request on arrival to show one of them — and the
            token list is the one surface here whose contents are credentials.
            The cost is a fetch per tab visit, which is what a route is. */}
        {/* **The 580px measure is the panel's, not each section's** (§34.5:
            *"every panel on Account sits on a 580px measure"*; the artboard
            puts it on each tab's content div). One place, so a third view
            cannot arrive a little wider than the other two. */}
        <div
          role="tabpanel"
          id={tabPanelId(ID_PREFIX, tab)}
          aria-labelledby={tabId(ID_PREFIX, tab)}
          tabIndex={-1}
          className={SETTINGS_MEASURE}
        >
          {/* `undefined` while the session probe is in flight is passed
              THROUGH, not flattened to `""` — `""` is ProfileSection's "your
              provider gave no address", and asserting that before the probe
              resolves tells a signed-in reader something false about their own
              account. */}
          {tab === "profile" && (
            <ProfileSection
              email={user === undefined ? undefined : (user?.email ?? "")}
              signIn={user ? { userId: user.id ?? "", name: user.name ?? null } : undefined}
            />
          )}
          {tab === "plan" && <PlanSection />}
          {tab === "security" && <PremiumSecurity />}
        </div>

        {/* **Sign out, on the phone only, below the tabs** — and this is the
            half of link 1's decision that lands here. §34.4's *"Sign out sits
            below [the tabs]"* is about THIS screen: a phone has no avatar
            popover to hold it, because §34.3 makes this a task the tab bar
            steps aside for. A desktop does have one, and putting it in both
            would be project rule 4 twice on one account — so `md:hidden`, and
            the desktop `/account` artboard has no sign-out either.

            To the static landing at `/`, with the signed-in hint cleared
            first — as `AccountMenu`'s, which says why. */}
        <div className="border-t border-hairline pt-4 md:hidden">
          <Button
            variant="secondary"
            size="touch"
            data-testid="account-sign-out"
            onClick={() => {
              // As `AccountMenu`'s: this account's conversations stay behind.
              if (user?.id) forgetAskConversationsOf(user.id);
              clearSignedInHint();
              void signOut({ callbackUrl: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
