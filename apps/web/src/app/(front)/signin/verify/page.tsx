import { VerifyScreen } from "@/components/front/VerifyScreen";
import { NOINDEX, pageMetadata } from "@/lib/siteMetadata";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";

// M62 (ADR-092): where the proxy sends a session that has passed Google and not
// yet its account's second factor. Request-rendered for the `callbackUrl`, which
// is untrusted input and goes through `safeCallbackUrl` before the screen may
// navigate to it.
export const metadata = pageMetadata({
  title: "Confirm it’s you",
  description: "Finish signing in to Caesura with your second step.",
  robots: NOINDEX,
});

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  return <VerifyScreen callbackUrl={safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null)} />;
}
