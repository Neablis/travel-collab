import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { cn } from "@/lib/cn";
import type { FaqEntry } from "@/lib/jsonLd";
import { SECURITY_CONTACTS } from "@/lib/securityContacts";

// `/security`: what protects a Caesura account, in plain words (M63 D10 to D14).
// It states outcomes, never configuration: no header names, hosts, vendors or
// libraries, and no certification (`SecurityScreen.test.tsx` holds it to both).
// Every sentence is a claim the PR body lists with its code location, for the
// milestone gate to check on production.
//
// Static and signed out, like `/ai` and `/developers`: outside `proxy.ts`'s matcher.

/**
 * The visible FAQ. `/security`'s page builds its `FAQPage` JSON-LD from this
 * same array, so a question can never be marked up without being shown.
 */
export const SECURITY_FAQ: readonly FaqEntry[] = [
  {
    question: "Do I have to use a second factor?",
    answer: "No. Signing in with Google is enough, and a second factor is optional. Add one under Account, then Security.",
  },
  {
    question: "What if I lose my phone?",
    answer: "Use one of your recovery codes to sign in, then remove the lost device. If it was your only one, turn the second step off, and turn it on again with a new device to get a new set of codes.",
  },
  {
    question: "Can I see what is connected to my account?",
    answer: "Yes. On the Premium plan, Account, then Security, lists your tokens and every app you have connected, and you can end any of them.",
  },
];

const linkClass = "text-brand underline";

/** The public security page: sign-in, what an AI tool can do, taking access back, data, and how to report a problem. */
export function SecurityScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/ai" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              AI
            </Link>
            <Link href="/signin" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}>
              Sign in
            </Link>
          </>
        }
      />

      <main className="mx-auto flex w-full max-w-180 flex-1 flex-col gap-10 px-4 pt-8 pb-16 md:px-7">
        <section className="flex flex-col gap-3">
          <DataText size="xs" className="text-2xs tracking-widest uppercase">
            Security
          </DataText>
          <Heading level={1} className="text-pretty">
            Security at Caesura
          </Heading>
          <Text className="text-md text-pretty">
            How you sign in, what an AI tool can do for you, how to take access back, and how to tell us about
            a problem.
          </Text>
        </section>

        <section aria-labelledby="sec-signin" className="flex flex-col gap-3">
          <Heading level={2} id="sec-signin">
            How you sign in
          </Heading>
          <Text className="text-pretty">You sign in to Caesura with Google.</Text>
          <Text className="text-pretty">
            You can add a second step, and it is optional. A passkey lets your device confirm it is you, with
            Face ID, a fingerprint or a PIN. An authenticator app gives you a 6-digit code. When you turn
            the second step on, you also get recovery codes, for the day you lose a device.
          </Text>
        </section>

        <section aria-labelledby="sec-ai" className="flex flex-col gap-3">
          <Heading level={2} id="sec-ai">
            What an AI tool or a token can do
          </Heading>
          <Text className="text-pretty">
            An AI tool or a token acts as you, holds only the permissions you give it, and can never do more
            than you can.
          </Text>
          <ul className="flex flex-col gap-1.5">
            <li>
              <Link href="/ai" className={linkClass}>
                What your AI can do in Caesura
              </Link>
            </li>
            <li>
              <Link href="/developers#scopes" className={linkClass}>
                What each permission allows
              </Link>
            </li>
          </ul>
        </section>

        <section aria-labelledby="sec-revoke" className="flex flex-col gap-3">
          <Heading level={2} id="sec-revoke">
            Taking access back
          </Heading>
          <ul className="flex flex-col gap-2.5">
            <li>
              Revoke a token under Account, then Security, and it stops working. API tokens and connected apps
              are on the Premium plan.
            </li>
            <li>Disconnect an app in Connected apps, and it stops working immediately.</li>
            <li>
              When you turn the second step on or off, remove a passkey or an authenticator app, or make new
              recovery codes, every other device you are signed in on is signed out.
            </li>
          </ul>
        </section>

        <section aria-labelledby="sec-data" className="flex flex-col gap-3">
          <Heading level={2} id="sec-data">
            Your data
          </Heading>
          <Text className="text-pretty">Connections to Caesura are encrypted.</Text>
          <Text className="text-pretty">
            We keep only a fingerprint of each API token and app connection, which cannot be turned back into it. The token itself is
            shown to you once, when you make it.
          </Text>
        </section>

        <section aria-labelledby="sec-report" className="flex flex-col gap-3">
          <Heading level={2} id="sec-report">
            Reporting a vulnerability
          </Heading>
          <Text className="text-pretty">
            Found something exploitable? Tell us privately, and please do not open a public issue for it.
          </Text>
          <ul className="flex flex-col gap-1.5">
            {SECURITY_CONTACTS.map((contact) => (
              <li key={contact.href}>
                <a href={contact.href} className={linkClass}>
                  {contact.label}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sec-faq" className="flex flex-col gap-4">
          <Heading level={2} id="sec-faq">
            Questions
          </Heading>
          {SECURITY_FAQ.map(({ question, answer }) => (
            <div key={question} className="flex flex-col gap-1">
              <Heading level={3}>{question}</Heading>
              <Text className="text-pretty">{answer}</Text>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-180 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-6 md:px-7">
          <Link href="/" className="text-xs text-slate">
            &larr; Caesura home
          </Link>
        </div>
      </footer>
    </div>
  );
}
