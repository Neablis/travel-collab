import { AppHeader } from "@/components/AppHeader";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";

// **The operator console's route group** (M20 link 7).
//
// Its own top-level group, NOT inside `(app)`: the design is explicit that this
// is an operator tool rather than a product surface — plainest primitives, no
// accent language, the assistant bubble gated off the route, and **not on the
// phone at all, entry point included**. Nesting it under the app shell would
// hand it the header, the phone tab bar and the assistant launcher, which is
// three decisions made by accident.
//
// **The app header is here, and the phone tab bar and assistant are not.**
// Mitchell, on the #174 preview: *"Introduce a navigation back to the account
// homepage here so i dont need to memorize urls"* — and he was describing a
// console you could only leave by typing a URL, because this group sits outside
// `(app)` and therefore inherited none of its chrome.
//
// This comment used to say nesting under `(app)` "would hand it the header, the
// phone tab bar and the assistant launcher, which is three decisions made by
// accident". That reasoning still holds and is why this is not nested — but it
// argued against the bundle, and was read (by me) as arguing against the
// header. **The design has always drawn the console with the header on it**:
// wordmark, Trips, Playbooks, the account avatar. "No product chrome" in
// `SPEC.md` §17.2 means no accent language and no assistant bubble, not no way
// out.
//
// So the header is mounted here explicitly — one decision, made on purpose,
// with the other two declined. `PhoneTabBar` is absent because the console is
// not on the phone at all; the assistant is absent because §17.2 gates it off
// this route by name.
//
// **`PreferencesProvider` is not optional decoration.** `usePreferences`
// tolerates a missing provider and answers defaults, but the account menu's
// *Your account* opens `AccountSettingsSheet`, which calls
// `useAccountPreferences` — and that one THROWS outside the provider. A bare
// `<AppHeader />` here would render a perfectly good menu that crashes the
// moment an operator opens the thing they came for.
//
// **The authorisation is not here, and that is still deliberate** — but the
// reason changed on 2026-09-14 and the old one is worth keeping visible.
//
// It used to read: the lint wall forbids a page or a layout importing
// `@/server/*`, so the gate lives in the API and `page.tsx` calls `notFound()`
// when the fetch 404s. `src/app/admin/**` is now on the wall's exempt shell, so
// that constraint is gone — and the placement does not change, because a layout
// is the wrong place for it on its own merits. A layout renders around whatever
// the route resolves to; putting the only check there makes every future page
// in this group secure by adjacency. `page.tsx` calls `adminUserId()` itself,
// the endpoints call `requireAdminApi()`, and both go through the same
// `callerIsAdmin` — one decision, two callers, neither inheriting it.
//
// 404 rather than 403, both places: a 403 confirms the route exists, and an
// operator console whose existence is confirmable is a list of endpoints worth
// attacking.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <AppHeader />
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* `md:block`/`hidden` rather than a redirect: the design says not on the
            phone at all, and a console that reflows to 375px is a console
            somebody will try to grant from on a train. */}
        <div className="hidden md:block">{children}</div>
        <p className="md:hidden text-sm text-slate">
          The operator console is not available on a small screen.
        </p>
      </div>
    </PreferencesProvider>
  );
}
