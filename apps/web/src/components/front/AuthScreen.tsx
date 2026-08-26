"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { AUTH_COPY, errorMessage, type AuthMode } from "@/components/front/authCopy";

// `useSearchParams()` is the only piece of this screen that needs a
// Suspense boundary during static prerender — isolating it in its own leaf
// component means the boundary wraps just this banner, not the whole
// screen. Wrapping the whole `<AuthScreen/>` (as an earlier version of this
// file did) makes Next prerender the *fallback* — i.e. nothing — into the
// shipped HTML, so the header, heading, Google button and footnote would
// all disappear until client JS hydrates. Scoping the boundary here keeps
// that static shell intact; only the error banner (which has nothing to
// show before hydration anyway) waits.
function AuthErrorBanner() {
  const failure = errorMessage(useSearchParams().get("error"));
  if (!failure) return null;
  return <Banner variant="danger">{failure}</Banner>;
}

// `dc.html:1584-1628`: sign-in and sign-up are the same screen with different
// copy (M15 scope item 2), so this is one component with a mode, not two
// near-identical files.
export function AuthScreen({ mode, devLoginEnabled }: { mode: AuthMode; devLoginEnabled: boolean }) {
  const copy = AUTH_COPY[mode];
  const [username, setUsername] = useState("");

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader />
      <main className="grid flex-1 place-items-center px-6 pt-3 pb-20">
        <div className="flex w-full max-w-101 flex-col gap-4.5">
          <div className="flex flex-col gap-2">
            <Heading level={1}>{copy.title}</Heading>
            <Text as="p" variant="secondary" className="text-pretty">{copy.sub}</Text>
          </div>

          <Suspense fallback={null}>
            <AuthErrorBanner />
          </Suspense>

          <Card raised className="flex flex-col gap-3.5">
            <Button
              type="button"
              variant="secondary"
              className="h-11.5 w-full text-md font-semibold"
              onClick={() => void signIn("google", { callbackUrl: "/" })}
            >
              Continue with Google
            </Button>

            <Text variant="secondary" className="text-xs text-pretty">{copy.scopeLine}</Text>

            {devLoginEnabled && (
              <form
                className="flex flex-col gap-2 border-t border-hairline pt-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void signIn("dev-login", { username, callbackUrl: "/" });
                }}
              >
                <FormField id="dev-login-username" label="Username" hint="Preview and local only">
                  <Input
                    id="dev-login-username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="ghost">Sign in with dev login</Button>
              </form>
            )}

            <div className="border-t border-hairline pt-3.5">
              <Text variant="secondary" className="text-sm">
                {copy.swapPrompt}{" "}
                <Link href={copy.swapHref} className="font-semibold text-brand underline">
                  {copy.swapCta}
                </Link>
              </Text>
            </div>
          </Card>

          <Text as="p" variant="secondary" className="text-xs text-pretty">{copy.footnote}</Text>
        </div>
      </main>
    </div>
  );
}
