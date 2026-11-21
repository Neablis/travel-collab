import Link from "next/link";
import { API_SCOPES, API_TOKEN_PREFIX, SCOPE_CATALOGUE, type ApiScope } from "@tc/contracts";
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
// - open signup, with an optional invite code: `server/users.ts`
//   `recordSignIn` (ADR-063) and the screen's own words in `front/authCopy.ts`
//   (`ADMISSION_FIELD_COPY`). The shared super code is deliberately not named.
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
function Code({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <DataText as="span" className={cn("rounded-sm bg-moss px-1 py-0.5 text-ink", className)}>
      {children}
    </DataText>
  );
}

/** One numbered step of the getting-started list, its number hidden from assistive tech (the `<ol>` already counts). */
function Step({
  n,
  title,
  level = 3,
  children,
}: {
  n: number;
  title: string;
  /** Heading level: 3 in getting-started, 4 under a connect section's own h3. */
  level?: 3 | 4;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 md:gap-4">
      <DataText
        size="sm"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand font-medium text-person-on"
        aria-hidden
      >
        {n}
      </DataText>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <Heading level={level}>{title}</Heading>
        {children}
      </div>
    </li>
  );
}

/** A code block: a URL or a command to copy. */
function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-hairline bg-surface p-3 font-mono text-sm text-ink">
      {children}
    </pre>
  );
}

// The same panels and section heading as `/ai` (see the note there), from the
// walk of PR 788. Inside "Connect your AI" each tool is a paper panel of its own,
// so six sets of steps do not run into one another.
const sectionClass =
  "flex scroll-mt-20 flex-col gap-5 rounded-xl border border-hairline bg-surface p-5 shadow-raised md:p-8";

/** A section's h2: the landing's section size, under a short brand rule that marks where a section starts. */
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span aria-hidden className="h-1 w-8 rounded-full bg-brand" />
      <Heading level={2} id={id} className="text-3xl text-pretty">
        {children}
      </Heading>
    </div>
  );
}

// The tool and scope tables: framed, a tinted head and banded rows so the eye
// can run along one tool. On a phone three columns do not fit, so each row
// stacks into a card of its cells; the head stays for screen readers only.
const tableFrameClass = "overflow-x-auto rounded-lg border border-hairline bg-surface";
const tableClass = "max-md:block";
const theadClass = "bg-moss max-md:sr-only";
const thClass = "px-3 py-2.5";
const rowClass = "last:border-b-0 even:bg-paper max-md:flex max-md:flex-col max-md:gap-1.5 max-md:p-3";
const tdClass = "px-3 py-3 max-md:p-0";

/** One tool's section of "Connect your AI": the anchor is the section's own id, and its steps are three or fewer. */
function ConnectSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-20 flex-col gap-4 rounded-lg border border-hairline bg-paper p-4 md:p-5"
    >
      <Heading level={3} id={`${id}-title`} className="text-xl">
        {title}
      </Heading>
      <ol className="flex flex-col gap-5">{children}</ol>
    </section>
  );
}

/**
 * One row of the MCP tool table. Shaped like `server/mcp/toolScopes`'s
 * `McpToolScope`, which the server page fills; UI may not import server
 * internals, so the shape is restated here and checked at the page's call.
 */
export interface McpToolRow {
  readonly name: string;
  readonly description: string;
  readonly scope: ApiScope;
  readonly orScope?: ApiScope;
}

/** The public developers page: the onboarding path to an API token, how to connect each AI tool, the scope table, and where the reference is. `tools` is the MCP tool table, joined by the server page. */
export function DevelopersScreen({ tools }: { tools: readonly McpToolRow[] }) {
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

      <main className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-6 px-4 pt-10 pb-16 md:gap-8 md:px-7 md:pt-14">
        <section className="flex flex-col gap-4 pb-4 md:pb-6">
          <DataText size="xs" className="text-2xs tracking-widest text-brand uppercase">
            Developers
          </DataText>
          <Heading level={1} className="text-4xl text-pretty">
            The Caesura API
          </Heading>
          <Text className="text-md text-pretty">
            Caesura is a trip planner for a group going somewhere together. The REST API under{" "}
            <Code>/api/v1</Code> reads and changes your own trips, days, stops, notebook pages and playbooks,
            as you.
          </Text>
          <Text className="text-base text-pretty">
            Not a developer? <InlineLink href="/ai">What your AI can do in Caesura</InlineLink>, and{" "}
            <InlineLink href="/security">how access is protected</InlineLink>.
          </Text>
          <Text variant="secondary" className="text-base text-pretty">
            A token acts as the person who made it. It holds only the scopes you give it, it always
            expires, and it can never do more than you can.
          </Text>
        </section>

        <section aria-labelledby="getting-started" className={sectionClass}>
          <SectionHeading id="getting-started">From nothing to a first call</SectionHeading>
          <ol className="flex flex-col gap-6">
            <Step n={1} title="Create your account">
              <Text className="text-pretty">
                Go to <InlineLink href="/signup">Create an account</InlineLink> and continue with Google.
                Anyone can sign up. If somebody sent you an invite code, press{" "}
                <em>Have an invite code?</em> and paste it there so they get the credit. Already have an
                account? <InlineLink href="/signin">Sign in</InlineLink>.
              </Text>
            </Step>
            <Step n={2} title="Be on the Premium plan">
              <Text className="text-pretty">
                API tokens are on the Premium plan. On any other plan the API tokens section shows an
                upgrade prompt instead of the form, and a token stops working if its owner&rsquo;s plan
                no longer includes the API. Restarting the subscription turns it back on.
              </Text>
            </Step>
            <Step n={3} title="Make a token">
              <Text className="text-pretty">
                <strong>Account → Security → API tokens → New token.</strong> Name it, tick what it may
                do (the scopes below), choose all your trips or only some, and pick how long it lives:
                30 days, 90 days or a year. Every token expires.
              </Text>
              <Text className="text-pretty">
                <strong>The secret is shown once.</strong> Copy it then, because nothing can show it again. Lose
                it and you revoke it and make another. Tokens start with <Code>{API_TOKEN_PREFIX}</Code>.
              </Text>
            </Step>
            <Step n={4} title="Discover, then call">
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
                <Code>{`{ "error": { "code", "message", "details" } }`}</Code>. Read the{" "}
                <Code>code</Code>.
              </Text>
            </Step>
          </ol>
        </section>

        {/* M55: the MCP connector (ADR-083), M63: one section per tool. Production's
            URL, written out: this page is static, and the connector a person
            adds is production's whichever deploy they read this on. Premium is
            the same `api.tokens` entitlement (D6); the consent page ticks every
            scope but the two `notebook:` ones (D5, `ConsentScreen.tsx`). The
            anchor ids sit on the sections so `#connect-claude` scrolls to the
            whole of one. The ChatGPT and Gemini sections are written from the
            vendors' docs and await a production proof (M63 D15). */}
        <section aria-labelledby="connect-ai" className={sectionClass}>
          <div className="flex flex-col gap-3">
            <SectionHeading id="connect-ai">Connect your AI</SectionHeading>
            <Text className="text-md text-pretty">
              An AI can plan in Caesura as you: read your trips and your library, write and publish playbooks,
              set and frame the cover photo of a playbook or a trip, and search for places. Pick the tool you use.
              Every path is the same account, and the same permissions, as you have in the app.
            </Text>
          </div>

          <ConnectSection id="connect-claude" title="Connect Claude">
            <Step level={4} n={1} title="Add a custom connector">
              <Text className="text-pretty">In Claude, add a custom connector with this URL:</Text>
              <Pre>https://caesura.today/api/mcp</Pre>
            </Step>
            <Step level={4} n={2} title="Sign in and allow it">
              <Text className="text-pretty">
                There is no token to copy. Claude sends you to Caesura to sign in and allow it, which needs the Premium plan. The page lists
                what it asks for in the words of <InlineLink href="#scopes">the scopes below</InlineLink>, and
                you can untick any of them. Notebook access starts unticked.
              </Text>
            </Step>
            <Step level={4} n={3} title="Disconnect when you like">
              <Text className="text-pretty">
                Every app you connect is listed in <strong>Account → Security → Connected apps</strong>, where
                Disconnect stops it at once.
              </Text>
            </Step>
          </ConnectSection>

          <ConnectSection id="connect-mcp" title="Connect an MCP client">
            <Step level={4} n={1} title="Add the server">
              <Text className="text-pretty">
                In Claude Code, Cursor or any client that speaks MCP over HTTP, put the same URL in the
                client&rsquo;s MCP config as a remote server:
              </Text>
              <Pre>https://caesura.today/api/mcp</Pre>
            </Step>
            <Step level={4} n={2} title="Sign in when the client asks">
              <Text className="text-pretty">
                The client opens Caesura&rsquo;s sign-in and consent page, as Claude does. The tools it gets are
                listed <InlineLink href="#mcp-tools">below</InlineLink>.
              </Text>
            </Step>
          </ConnectSection>

          <ConnectSection id="connect-chatgpt" title="Connect ChatGPT">
            <Step level={4} n={1} title="Make a token">
              <Text className="text-pretty">Make an API token as above, with the scopes the GPT should have. API tokens need the Premium plan.</Text>
            </Step>
            <Step level={4} n={2} title="Import the OpenAPI document as an Action">
              <Text className="text-pretty">
                In your GPT&rsquo;s configuration, add an Action and import this URL. The import needs the document&rsquo;s URL, not a
                pasted copy of its text, because the document names its server as an absolute address:
              </Text>
              <Pre>https://caesura.today/api/v1/openapi</Pre>
            </Step>
            <Step level={4} n={3} title="Authenticate with the token">
              <Text className="text-pretty">
                Set the Action&rsquo;s authentication to API key, auth type Bearer, and paste the token.
              </Text>
            </Step>
          </ConnectSection>

          <ConnectSection id="connect-gemini" title="Connect Gemini">
            <Step level={4} n={1} title="Make a scoped token">
              <Text className="text-pretty">Make an API token holding only the scopes your tools need. API tokens need the Premium plan.</Text>
            </Step>
            <Step level={4} n={2} title="Declare functions from the OpenAPI document">
              <Text className="text-pretty">
                Read <InlineLink href="/api/v1/openapi">/api/v1/openapi</InlineLink> and declare each operation you
                want as a function for Gemini&rsquo;s function calling.
              </Text>
            </Step>
            <Step level={4} n={3} title="Call the API with the token">
              <Text className="text-pretty">
                When Gemini asks for a function, make that request yourself with <Code>Authorization: Bearer</Code>{" "}
                and the token, and return the response to it.
              </Text>
            </Step>
          </ConnectSection>

          <ConnectSection id="connect-poppy" title="Connect Poppy agents">
            <Step level={4} n={1} title="There is nothing to set up">
              <Text className="text-pretty">
                A Poppy agent discovers{" "}
                <InlineLink href="/.well-known/poppy.json">/.well-known/poppy.json</InlineLink> on its own and takes it
                from there.
              </Text>
            </Step>
          </ConnectSection>

          <ConnectSection id="connect-script" title="Connect a script">
            <Step level={4} n={1} title="Make a token with trips:read">
              <Text className="text-pretty">
                A script needs only the scopes it uses. To list your trips, <Code>trips:read</Code> is enough. API tokens need the Premium plan.
              </Text>
            </Step>
            <Step level={4} n={2} title="Call the API">
              <Pre>{`curl https://caesura.today/api/v1/trips \\\n  -H "Authorization: Bearer ${API_TOKEN_PREFIX}..."`}</Pre>
            </Step>
          </ConnectSection>

          <section aria-labelledby="mcp-tools" className="flex flex-col gap-3 pt-2">
            <Heading level={3} id="mcp-tools" className="text-xl">
              MCP tools
            </Heading>
            <Text variant="secondary" className="text-base text-pretty">
              What the connector offers, and the scope each tool needs. A token or a connected app that lacks the
              scope cannot use the tool.
            </Text>
            <div className={tableFrameClass}>
              <Table className={tableClass}>
                <THead className={theadClass}>
                  <TR>
                    <TH scope="col" className={thClass}>Tool</TH>
                    <TH scope="col" className={thClass}>What it does</TH>
                    <TH scope="col" className={thClass}>Scope</TH>
                  </TR>
                </THead>
                <TBody className="max-md:block">
                  {tools.map((tool) => (
                    <TR key={tool.name} className={rowClass}>
                      <TD className={cn(tdClass, "whitespace-nowrap")}>
                        <Code className="font-medium">{tool.name}</Code>
                      </TD>
                      <TD className={cn(tdClass, "text-sm text-pretty")}>{tool.description}</TD>
                      <TD className={cn(tdClass, "text-sm md:w-1/4")}>
                        <Code className="whitespace-nowrap">{tool.scope}</Code>
                        {tool.orScope === undefined ? null : (
                          <>
                            {" or "}
                            <Code className="whitespace-nowrap">{tool.orScope}</Code>
                          </>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        </section>

        <section aria-labelledby="scopes" className={sectionClass}>
          <SectionHeading id="scopes">Scopes</SectionHeading>
          <Text variant="secondary" className="text-base text-pretty">
            Nothing implies anything else: <Code>trips:write</Code> does not include{" "}
            <Code>trips:read</Code>. Ask for both if you need both.
          </Text>
          <div className={tableFrameClass}>
            <Table className={tableClass}>
              <THead className={theadClass}>
                <TR>
                  <TH scope="col" className={thClass}>Scope</TH>
                  <TH scope="col" className={thClass}>What a token holding it may do</TH>
                </TR>
              </THead>
              <TBody className="max-md:block">
                {API_SCOPES.map((scope) => (
                  <TR key={scope} className={rowClass}>
                    <TD className={cn(tdClass, "whitespace-nowrap")}>
                      <Code className="font-medium">{scope}</Code>
                    </TD>
                    <TD className={cn(tdClass, "text-sm text-pretty")}>{SCOPE_CATALOGUE[scope].description}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </section>

        <section aria-labelledby="reference" className={sectionClass}>
          <SectionHeading id="reference">The reference</SectionHeading>
          <ul className="grid gap-3 md:grid-cols-2">
            {REFERENCE_LINKS.map(({ href, label, note }) => (
              <li key={href} className="flex flex-col gap-1 rounded-lg bg-moss p-4">
                <InlineLink href={href}>{label}</InlineLink>
                <Text variant="secondary">{note}</Text>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-200 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-6 md:px-7">
          <Link href="/" className="text-xs text-slate">
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
