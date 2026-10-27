import { redirect } from "next/navigation";
import { ConsentErrorBack, ConsentRefused, ConsentScreen } from "@/components/oauth/ConsentScreen";
import { NOINDEX, pageMetadata } from "@/lib/siteMetadata";
import { auth } from "@/server/auth";
import { accountCan } from "@/server/entitlements/resolver";
import { parseAuthorizeRequest, type AuthorizeParams } from "@/server/oauth/authorizeRequest";

// **`GET /oauth/authorize`: the consent page** (ADR-083 §6). A server page, so
// the request is checked before anything renders: an app or redirect that is
// not proven is shown here and never redirected. An error after that goes back
// to the client with `state` and `iss`: straight back for a recognised
// redirect, and through a link the person clicks for any other (amendment M).
//
// `/oauth/*` is outside the proxy's matcher (`proxy.ts`), so signing in is this
// page's own job: it sends a signed-out person to sign in and back to this
// exact URL, every parameter included.

export const metadata = pageMetadata({
  title: "Connect an app",
  description: "Decide whether an app may use your Caesura account.",
  robots: NOINDEX,
});

/** The query as it arrived, for the sign-in round trip. */
function queryOf(params: AuthorizeParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, one);
  }
  return query.toString();
}

/** The consent page: sign in, then a refusal, an error for the client, or consent. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<AuthorizeParams> }) {
  const params = await searchParams;
  const userId = (await auth())?.user?.id;
  if (userId === undefined) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/oauth/authorize?${queryOf(params)}`)}`);
  }
  const parsed = await parseAuthorizeRequest(params, { userId });
  if ("redirectTo" in parsed) {
    if (parsed.automatic) redirect(parsed.redirectTo);
    return <ConsentErrorBack description={parsed.description} redirectTo={parsed.redirectTo} />;
  }
  if ("show" in parsed) return <ConsentRefused description={parsed.show.description} />;
  const { request } = parsed;
  // A parsed request has no repeated parameter, so every value is one string.
  const posted = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return (
    <ConsentScreen
      clientName={request.client.clientName}
      marking={request.marking}
      redirectHost={new URL(request.redirectUri).host}
      cimdHost={request.client.cimdHost}
      scopes={request.scopes}
      entitled={await accountCan(userId, "api.tokens")}
      params={posted}
    />
  );
}
