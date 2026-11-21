import Link from "next/link";
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
    tool: "Claude",
    prompt: "Turn my Lisbon trip into a three-day playbook and publish it.",
    href: "/developers#connect-claude",
    link: "Connect Claude",
  },
  {
    tool: "MCP clients",
    prompt: "Which of my trips has a day with nothing planned yet?",
    href: "/developers#connect-mcp",
    link: "Connect an MCP client",
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
      "Anything you cannot do yourself, or anything you did not give it permission for. Notebook access starts switched off, and it stops the moment you disconnect the tool.",
  },
];

const linkClass = "text-brand underline";

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

      <main className="mx-auto flex w-full max-w-180 flex-1 flex-col gap-10 px-4 pt-8 pb-16 md:px-7">
        <section className="flex flex-col gap-3">
          <DataText size="xs" className="text-2xs tracking-widest uppercase">
            Caesura and AI
          </DataText>
          <Heading level={1} className="text-pretty">
            Caesura works with your AI
          </Heading>
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

        <section aria-labelledby="ai-ways" className="flex flex-col gap-3">
          <Heading level={2} id="ai-ways">
            Ways in
          </Heading>
          <ul className="flex flex-col gap-2.5">
            <li>
              <strong>The assistant</strong> is built into Caesura and plans alongside you.
            </li>
            <li>
              <strong>The MCP server</strong> lets Claude and other MCP apps use Caesura as you.
            </li>
            <li>
              Tools that cannot sign in themselves use <strong>scoped tokens</strong>, each holding only the
              permissions you choose.{" "}
              <Link href="/developers#scopes" className={linkClass}>
                See what the scopes allow
              </Link>
              .
            </li>
            <li>
              <strong>The public API</strong> is for scripts and custom tools, with a{" "}
              <Link href="/developers/reference" className={linkClass}>
                reference to read
              </Link>
              .
            </li>
            <li>
              <strong>Poppy</strong> agents find Caesura on their own.
            </li>
            <li>
              <a href="/llms.txt" className={linkClass}>
                llms.txt
              </a>{" "}
              and{" "}
              <a href="/agents.md" className={linkClass}>
                agents.md
              </a>{" "}
              are plain-text guides written for an AI to read first.
            </li>
            <li>
              <strong>Connected apps</strong>, under Account and Security, lists every tool you have connected.
            </li>
          </ul>
        </section>

        <section aria-labelledby="ai-prompts" className="flex flex-col gap-4">
          <Heading level={2} id="ai-prompts">
            Try asking
          </Heading>
          <ul className="flex flex-col gap-5">
            {PROMPTS.map(({ tool, prompt, href, link }) => (
              <li key={tool} className="flex flex-col gap-1">
                <DataText size="xs" className="text-2xs tracking-widest uppercase">
                  {tool}
                </DataText>
                <Text className="text-pretty">{prompt}</Text>
                <Link href={href} className={cn(linkClass, "text-sm")}>
                  {link}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ai-safe" className="flex flex-col gap-3">
          <Heading level={2} id="ai-safe">
            Safe by design
          </Heading>
          <Text className="text-pretty">
            An AI tool can never do more than you can. You choose what it may do, and you can disconnect it at
            any time in Connected apps.
          </Text>
        </section>

        <section aria-labelledby="ai-faq" className="flex flex-col gap-4">
          <Heading level={2} id="ai-faq">
            Questions
          </Heading>
          {AI_FAQ.map(({ question, answer }) => (
            <div key={question} className="flex flex-col gap-1">
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
            </div>
          ))}
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
