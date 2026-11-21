import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { cn } from "@/lib/cn";
import type { FaqEntry } from "@/lib/jsonLd";

// `/ai`: what an AI tool can do in Caesura, for someone who is not a developer
// (M63 D1, D4 to D7). It explains and points; it never restates setup steps,
// which `/developers#connect-*` owns, or the scope table, which
// `/developers#scopes` renders from the contract. It says nothing about how
// Caesura is built (`AiScreen.test.tsx` holds it to a deny-list).
//
// Static and signed out, like `/developers`: outside `proxy.ts`'s matcher, no
// session, no fetch, no client component beyond the shared shell.

/** One prompt to try, the tool it is for, and the `/developers` section that connects that tool. */
const PROMPTS = [
  {
    tool: "MCP clients",
    prompt: "Which of my trips has a day with nothing planned yet?",
    href: "/developers#connect-mcp",
    link: "Connect an MCP client",
  },
  {
    tool: "Claude",
    prompt: "Turn my Lisbon trip into a three-day playbook and publish it.",
    href: "/developers#connect-claude",
    link: "Connect Claude",
  },
  {
    tool: "ChatGPT",
    prompt: "Draft a playbook day in Kyoto around three restaurants I name, and put each on the map.",
    href: "/developers#connect-chatgpt",
    link: "Connect ChatGPT",
  },
  {
    tool: "Gemini",
    prompt: "Look through the library and pick the days that suit a rainy weekend in Porto.",
    href: "/developers#connect-gemini",
    link: "Connect Gemini",
  },
  {
    tool: "Poppy agents",
    prompt: "List the cities that have published days in Caesura's library.",
    href: "/developers#connect-poppy",
    link: "Connect Poppy agents",
  },
  {
    tool: "A script",
    prompt: "List the names of all my trips and save them to a file.",
    href: "/developers#connect-script",
    link: "Connect a script",
  },
] as const;

/**
 * The visible FAQ. `/ai`'s page builds its `FAQPage` JSON-LD from this same
 * array, so a question can never be marked up without being shown.
 */
export const AI_FAQ: readonly FaqEntry[] = [
  {
    question: "Does Caesura work with Claude?",
    answer:
      "Yes. Add Caesura to Claude as a connector, sign in, and choose what it may do. Any other app that speaks MCP connects the same way.",
  },
  {
    question: "Does Caesura work with ChatGPT?",
    answer: "Yes. A GPT you build can call Caesura with a token you make, holding only the permissions you choose.",
  },
  {
    question: "Is my data safe with an AI tool?",
    answer: "An AI tool can only do what you allow, and you can disconnect it at any time.",
  },
  {
    question: "What can an agent not do?",
    answer:
      "Anything you cannot do yourself, or anything you did not give it permission for. Reading starts ticked; anything that changes your data, Notebook included, starts unticked. Access stops the moment you disconnect the tool.",
  },
];

const linkClass = "text-brand underline";

// The walk of PR 788: headings that did not read as headings, sections that bled
// together, lists that did not stand out. So each section is its own white panel
// on the paper, headed at the front door's section size under a short brand rule,
// and each list item is a moss tile inside it. `/security` and `/developers`
// use the same three pieces.
const sectionClass =
  "flex scroll-mt-20 flex-col gap-5 rounded-xl border border-hairline bg-surface p-5 shadow-raised md:p-8";
const itemClass = "rounded-lg bg-moss p-4 text-base text-ink";

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

/** The public AI page: what your AI can do in Caesura, one prompt per tool, one safety line, and a short FAQ. */
export function AiScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/developers" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Developers
            </Link>
            <Link href="/signin" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}>
              Sign in
            </Link>
          </>
        }
      />

      <main className="mx-auto flex w-full max-w-180 flex-1 flex-col gap-6 px-4 pt-10 pb-16 md:gap-8 md:px-7 md:pt-14">
        <section className="flex flex-col gap-4 pb-4 md:pb-6">
          <DataText size="xs" className="text-2xs tracking-widest text-brand uppercase">
            Caesura and AI
          </DataText>
          <Heading level={1} className="text-4xl text-pretty">
            An AI trip planner that works with Claude, ChatGPT and Gemini
          </Heading>
          <Text className="text-md text-pretty">
            Caesura is a trip planner that works with the AI you already use. Claude trip planning runs through
            its trip planner MCP server, and its travel planning API is open to agents and scripts.
          </Text>
          <Text className="text-md text-pretty">
            Ask Claude, ChatGPT, Gemini or another AI tool to plan in Caesura for you. It can read your trips
            and your library, write and publish playbooks, set the cover photo of a playbook or a trip, and
            search for places, all as you.
          </Text>
          <Text variant="secondary" className="text-base text-pretty">
            Connecting an outside AI tool needs the Premium plan. Caesura&rsquo;s own assistant is already in the
            app.
          </Text>
        </section>

        <section aria-labelledby="ai-ways" className={sectionClass}>
          <SectionHeading id="ai-ways">Ways in</SectionHeading>
          <ul className="grid gap-3 md:grid-cols-2">
            <li className={itemClass}>
              <strong>The MCP server</strong> lets Claude and other MCP apps use Caesura as you.
            </li>
            <li className={itemClass}>
              <strong>Poppy</strong> agents find Caesura on their own.
            </li>
            <li className={itemClass}>
              <strong>The assistant</strong> is built into Caesura and plans alongside you.
            </li>
            <li className={itemClass}>
              Tools that cannot sign in themselves use <strong>scoped tokens</strong>, each holding only the
              permissions you choose.{" "}
              <Link href="/developers#scopes" className={linkClass}>
                See what the scopes allow
              </Link>
              .
            </li>
            <li className={itemClass}>
              <strong>The public API</strong> is for scripts and custom tools, with a{" "}
              <Link href="/developers/reference" className={linkClass}>
                reference to read
              </Link>
              .
            </li>
            <li className={itemClass}>
              <a href="/llms.txt" className={linkClass}>
                llms.txt
              </a>{" "}
              and{" "}
              <a href="/agents.md" className={linkClass}>
                agents.md
              </a>{" "}
              are plain-text guides written for an AI to read first.
            </li>
            <li className={itemClass}>
              <strong>Playbooks</strong> are real days from real trips, which your AI can read and publish.{" "}
              <Link href="/playbooks" className={linkClass}>
                Browse the playbooks
              </Link>
              .
            </li>
            <li className={cn(itemClass, "md:col-span-2")}>
              Under Account and Security, <strong>Connected apps</strong> lists the tools you signed in to, and{" "}
              <strong>API tokens</strong> lists the tokens you made for the rest, such as ChatGPT, Gemini and
              scripts.
            </li>
          </ul>
        </section>

        <section aria-labelledby="ai-prompts" className={sectionClass}>
          <SectionHeading id="ai-prompts">Try asking</SectionHeading>
          <ul className="grid gap-3 md:grid-cols-2">
            {PROMPTS.map(({ tool, prompt, href, link }) => (
              <li key={tool} className={cn(itemClass, "flex flex-col items-start gap-3")}>
                <Badge variant="brand">{tool}</Badge>
                <Text className="flex-1 border-l-2 border-brand pl-3 text-md font-medium text-pretty">{prompt}</Text>
                <Link href={href} className={cn(linkClass, "text-sm font-medium")}>
                  {link}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* The one claim the page exists to make, so it is the one tinted panel. */}
        <section
          aria-labelledby="ai-safe"
          className={cn(sectionClass, "border-brand-tint bg-brand-tint")}
        >
          <SectionHeading id="ai-safe">Safe by design</SectionHeading>
          <Text className="text-md text-pretty">
            An AI tool can never do more than you can. You choose what it may do, and you can disconnect it at
            any time: in Connected apps, or by revoking its token under API tokens.
          </Text>
        </section>

        <section aria-labelledby="ai-faq" className={sectionClass}>
          <SectionHeading id="ai-faq">Questions</SectionHeading>
          <ul className="flex flex-col gap-3">
            {AI_FAQ.map(({ question, answer }) => (
              <li key={question} className={cn(itemClass, "flex flex-col gap-1.5")}>
                <Heading level={3}>{question}</Heading>
                <Text className="text-pretty">
                  {answer}
                  {question === "Is my data safe with an AI tool?" ? (
                    <>
                      {" "}
                      <Link href="/security" className={linkClass}>
                        Read about security
                      </Link>
                      .
                    </>
                  ) : null}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-180 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-6 md:px-7">
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
