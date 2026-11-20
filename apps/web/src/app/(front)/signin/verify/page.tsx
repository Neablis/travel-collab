"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";

// M62 part 1 (ADR-092): a placeholder, so the proxy's redirect for an account that
// asks for a second factor lands somewhere. Part 2 replaces it with the real screen.
export default function VerifyPage() {
  return (
    <main>
      <Heading level={1}>Confirm it&rsquo;s you</Heading>
      <Button type="button" onClick={() => void signOut({ callbackUrl: "/" })}>
        Sign out
      </Button>
    </main>
  );
}
