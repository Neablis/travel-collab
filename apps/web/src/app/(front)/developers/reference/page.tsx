import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { cn } from "@/lib/cn";
import { pageMetadata } from "@/lib/siteMetadata";
import { ApiReferenceClient } from "./ApiReferenceClient";

// The api-catalog's `service-doc`: the OpenAPI document drawn for a person.
// Public for the same reason `/developers` is — outside `proxy.ts`'s matcher.
// The front door's header sits above Scalar so the page is visibly Caesura's
// and has a way home; everything under it is Scalar's own layout.
export const metadata = pageMetadata({
  title: "API reference",
  description: "Every endpoint of the Caesura API: its scope, its request and its response.",
});

/** `/developers/reference`: the Scalar-rendered API reference under the front door's header. */
export default function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <FrontDoorHeader
        actions={
          <>
            <Link href="/developers" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Getting a token
            </Link>
            <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}>
              Caesura home
            </Link>
          </>
        }
      />
      {/* A <main> and an `h1` of our own: Scalar's layout brings neither, so
          the page had no main landmark and no top-level heading. The heading
          is screen-reader only because the reference's own sidebar already
          says what this is to anyone who can see it. */}
      <main className="border-t border-hairline">
        <Heading level={1} className="sr-only">
          API reference
        </Heading>
        <ApiReferenceClient />
      </main>
    </div>
  );
}
