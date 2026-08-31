import { auth } from "@/server/auth";
import { PublicProfileResponse } from "@/lib/playbooks";
import { citiesKnownBy, discoverDays, publicAuthor } from "@/server/playbooks";

export const runtime = "nodejs";

// A public profile (M11b link 8). **Derived, never authored** — there is no
// public user record to read, and §15 says there does not need to be: every
// number here is computed from that person's days, so a profile can never
// disagree with Discover.
//
// The day list is `discoverDays` itself, scoped to this person, rather than a
// second query shaped like it. That is the whole agreement property: the cards
// on a profile ARE Discover cards, produced by the same function, so "a
// profile's day count and adds agree with the same person's numbers in
// Discover" is true by construction rather than by two queries staying in step.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { userId } = await params;

  const [author, knows, discovered] = await Promise.all([
    publicAuthor(userId),
    citiesKnownBy(userId),
    // `everyone` scope with `authorId` set, NOT the `yours` scope: a profile
    // shows what this person has PUBLISHED, and the reader is usually not them.
    // Their private days stay invisible here even when the reader IS the
    // author — a profile is what other people see, and showing its owner a
    // different page than everybody else is how a profile starts disagreeing
    // with itself.
    discoverDays({
      cities: [],
      scope: "everyone",
      authorId: userId,
      sort: "newest",
      budget: "any",
      month: null,
      readerId: session.user.id,
    }),
  ]);

  return Response.json(
    PublicProfileResponse.parse({
      author,
      knows,
      days: discovered.days,
    }),
  );
}
