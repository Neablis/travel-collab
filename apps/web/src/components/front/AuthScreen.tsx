"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Heading } from "@/components/ui/heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";

// One component, two modes — they differ only in copy (M15 scope item 2).
// Task 3 fills in that copy from dc.html:3388-3396 and adds the error states.
export function AuthScreen({
  mode,
  devLoginEnabled,
}: {
  mode: "signin" | "signup";
  devLoginEnabled: boolean;
}) {
  const [username, setUsername] = useState("");

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader />
      <main className="flex flex-1 items-center justify-center px-6 pb-20">
        <div className="flex w-full max-w-101 flex-col gap-4.5">
          <Heading level={1}>{mode === "signup" ? "Start planning with Caesura" : "Welcome back"}</Heading>

          <Card raised className="flex flex-col gap-3.5">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => void signIn("google", { callbackUrl: "/" })}
            >
              Continue with Google
            </Button>

            {devLoginEnabled && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void signIn("dev-login", { username, callbackUrl: "/" });
                }}
              >
                <FormField id="dev-login-username" label="Username">
                  <Input
                    id="dev-login-username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="ghost">
                  Sign in with dev login
                </Button>
              </form>
            )}

            <Link href={mode === "signup" ? "/signin" : "/signup"} className="text-sm font-semibold text-brand">
              {mode === "signup" ? "Sign in" : "Create an account"}
            </Link>
          </Card>
        </div>
      </main>
    </div>
  );
}
