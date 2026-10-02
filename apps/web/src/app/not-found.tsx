import Link from "next/link";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";

// One body for every 404, on purpose: a private, moderated, deleted or unknown
// playbook must be indistinguishable (ADR-061 decision 2), so this page says
// nothing about what was asked for. Next marks a 404 `noindex` itself.
/** The site's 404 page. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-3 px-6">
      <Heading level={1}>This page is not here</Heading>
      <Text>It may have moved, or it may never have been shared.</Text>
      <div className="flex gap-4">
        <Link href="/playbooks" className="text-sm underline">
          Browse playbooks
        </Link>
        <Link href="/" className="text-sm underline">
          Caesura home
        </Link>
      </div>
    </main>
  );
}
