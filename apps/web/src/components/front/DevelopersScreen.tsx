import Link from "next/link";
import { API_SCOPES, API_TOKEN_PREFIX, SCOPE_CATALOGUE } from "@tc/contracts";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { cn } from "@/lib/cn";

// `/developers`: how a person — or the agent they are setting up — gets from
// nothing to an authenticated API call. Written for the reader who arrived from
// `/llms.txt` or the api-catalog knowing only the host.
//
// **Every sentence here is a fact somebody else's code owns**, and each one
// cites it, so a change there knows to change this:
// - invite-only, and the two ways in: `server/admission.ts` `redeemAdmission`
//   (a trip-invite token, or a code), and the screen's own words in
//   `front/authCopy.ts` (`hint`, `MISSING_INVITE_CODE`). The shared super code
//   is deliberately not named — it is Mitchell's to hand out, not a door.
// - Premium: `api.tokens` is granted by `premium` and by no other plan
//   (`packages/contracts/src/entitlement.ts`, `planVersions.test.ts`).
// - the form: `account/TokensSection.tsx` — Name, What it may do, Which
//   trips, Expires after (30 days, 90 days, a year), the secret shown once.
// - the scopes: `SCOPE_CATALOGUE`, rendered rather than retyped, the same
//   record `openapi.ts` publishes and the token form draws. A new scope
//   appears here in the diff that adds it.
//
// Static and runs on nothing, like the landing page (SPEC §14): no session, no
// fetch. It is outside `proxy.ts`'s matcher, so a signed-out visitor and a
// crawler both get it.

const REFERENCE_LINKS = [
  { href: "/developers/reference", label: "API reference", note: "The OpenAPI document, drawn for reading, with a request runner." },
  { href: "/api/v1/openapi", label: "/api/v1/openapi", note: "The OpenAPI 3.0 document itself. No token." },
  { href: "/.well-known/api-catalog", label: "/.well-known/api-catalog", note: "RFC 9727 linkset pointing at both of the above. No token." },
  { href: "/llms.txt", label: "/llms.txt", note: "This page's summary, for a model to read first." },
] as const;

/** A link in running text. Plain `<a>` for the API's own JSON and text files, which are not pages. */
function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  const className = "text-brand underline";
  return href.startsWith("/api/") || href.startsWith("/.well-known/") || href.endsWith(".txt") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** An inline code span — a path, a header, a scope — in running text. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <DataText as="span" className="rounded-sm bg-moss px-1 py-0.5 text-ink">
      {children}
    </DataText>
  );
}

/** One numbered step of the getting-started list, its number hidden from assistive tech (the `<ol>` already counts). */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <DataText size="base" className="w-6 shrink-0 pt-0.5 text-right" aria-hidden>
        {n}.
      </DataText>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading level={3}>{title}</Heading>
        {children}
      </div>
    </li>
  );
}

/** The public developers page: the onboarding path to an API token, the scope table, and where the reference is. */
export function DevelopersScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/developers/reference" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              API reference
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
            Developers
          </DataText>
          <Heading level={1} className="text-pretty">
            The Caesura API
          </Heading>
          <Text className="text-md text-pretty">
            Caesura is a trip planner for a group going somewhere together. The REST API under{" "}
            <Code>/api/v1</Code> reads and changes your own trips, days, stops, notebook pages and playbooks,
            as you.
          </Text>
          <Text variant="secondary" className="text-base text-pretty">
            A token acts as the person who made it. It holds only the scopes you give it, it always
            expires, and it can never do more than you can.
          </Text>
        </section>

        <section aria-labelledby="getting-started" className="flex flex-col gap-5">
          <Heading level={2} id="getting-started">
            From nothing to a first call
          </Heading>
          <ol className="flex flex-col gap-6">
            <Step n={1} title="Get invited">
              <Text className="text-pretty">
                Caesura is invite-only while it is small. There are two ways in: an{" "}
                <strong>invite code</strong> somebody already on Caesura sent you, or a{" "}
                <strong>trip invite link</strong> to their trip, which admits you on its own — no code
                needed.
              </Text>
            </Step>
            <Step n={2} title="Create your account">
              <Text className="text-pretty">
                Go to <InlineLink href="/signup">Create an account</InlineLink>, paste your code into{" "}
                <em>Invite code</em>, and continue with Google. Arriving from a trip invite link? Open the
                link first and leave the code empty. Already have an account?{" "}
                <InlineLink href="/signin">Sign in</InlineLink>.
              </Text>
            </Step>
            <Step n={3} title="Be on the Premium plan">
              <Text className="text-pretty">
                API tokens are on the Premium plan. On any other plan the API tokens section shows an
                upgrade prompt instead of the form, and a token stops working if its owner&rsquo;s plan
                no longer includes the API — restarting the subscription turns it back on.
              </Text>
            </Step>
            <Step n={4} title="Make a token">
              <Text className="text-pretty">
                <strong>Account → Profile → API tokens → New token.</strong> Name it, tick what it may
                do (the scopes below), choose all your trips or only some, and pick how long it lives:
                30 days, 90 days or a year. Every token expires.
              </Text>
              <Text className="text-pretty">
                <strong>The secret is shown once.</strong> Copy it then — nothing can show it again. Lose
                it and you revoke it and make another. Tokens start with <Code>{API_TOKEN_PREFIX}</Code>.
              </Text>
            </Step>
            <Step n={5} title="Discover, then call">
              <Text className="text-pretty">
                Start from <InlineLink href="/.well-known/api-catalog">/.well-known/api-catalog</InlineLink>:
                its <Code>service-desc</Code> is <InlineLink href="/api/v1/openapi">/api/v1/openapi</InlineLink>,
                which describes every endpoint, its scope and its shapes. Its paths begin{" "}
                <Code>/v1/</Code> and are served under <Code>/api</Code>. Send the token on every request:
              </Text>
              <pre className="overflow-x-auto rounded-md border border-hairline bg-surface p-3 font-mono text-sm text-ink">
                {`curl https://<host>/api/v1/account \\\n  -H "Authorization: Bearer ${API_TOKEN_PREFIX}..."`}
              </pre>
              <Text variant="secondary" className="text-pretty">
                Collections take <Code>?limit=</Code> (1–200) and an opaque <Code>?cursor=</Code>; read{" "}
                <Code>nextCursor</Code> until it is <Code>null</Code>. Every error is{" "}
                <Code>{`{ "error": { "code", "message", "details" } }`}</Code> — read the{" "}
                <Code>code</Code>.
              </Text>
            </Step>
          </ol>
        </section>

        <section aria-labelledby="scopes" className="flex flex-col gap-3">
          <Heading level={2} id="scopes">
            Scopes
          </Heading>
          <Text variant="secondary" className="text-base text-pretty">
            Nothing implies anything else: <Code>trips:write</Code> does not include{" "}
            <Code>trips:read</Code>. Ask for both if you need both.
          </Text>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Scope</TH>
                  <TH scope="col">What a token holding it may do</TH>
                </TR>
              </THead>
              <TBody>
                {API_SCOPES.map((scope) => (
                  <TR key={scope}>
                    <TD className="whitespace-nowrap">
                      <Code>{scope}</Code>
                    </TD>
                    <TD className="text-pretty">{SCOPE_CATALOGUE[scope].description}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>

        <section aria-labelledby="reference" className="flex flex-col gap-3">
          <Heading level={2} id="reference">
            The reference
          </Heading>
          <ul className="flex flex-col gap-2.5">
            {REFERENCE_LINKS.map(({ href, label, note }) => (
              <li key={href} className="flex flex-col">
                <InlineLink href={href}>{label}</InlineLink>
                <Text variant="secondary">{note}</Text>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-180 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-6 md:px-7">
          <Link href="/welcome" className="text-xs text-slate">
            &larr; Caesura home
          </Link>
          <Text as="span" variant="muted" aria-hidden>
            &middot;
          </Text>
          <a href="mailto:mitchell@demarcosoftware.com" className="text-xs text-slate">
            mitchell@demarcosoftware.com
          </a>
        </div>
      </footer>
    </div>
  );
}
