// **The operator console's route group** (M20 link 7).
//
// Its own top-level group, NOT inside `(app)`: the design is explicit that this
// is an operator tool rather than a product surface — plainest primitives, no
// accent language, the assistant bubble gated off the route, and **not on the
// phone at all, entry point included**. Nesting it under the app shell would
// hand it the header, the phone tab bar and the assistant launcher, which is
// three decisions made by accident.
//
// **The authorisation is not here, and that is deliberate.** AGENTS.md's lint
// wall forbids a page or a layout importing `@/server/*` — UI calls the API —
// and it is not a rule to bend for a console. So the gate lives where the wall
// already puts it: `GET /api/admin/overview` checks `users.is_admin`
// server-side and answers **404** to everyone else, and `page.tsx` calls Next's
// `notFound()` when it does. A non-admin therefore reaches a 404 for the route
// AND a 404 for the endpoint, which is what the gate box asks for; the route
// group is not merely hidden, because there is no admin data behind it that a
// server check has not passed.
//
// 404 rather than 403, both places: a 403 confirms the route exists, and an
// operator console whose existence is confirmable is a list of endpoints worth
// attacking.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* `md:block`/`hidden` rather than a redirect: the design says not on the
          phone at all, and a console that reflows to 375px is a console
          somebody will try to grant from on a train. */}
      <div className="hidden md:block">{children}</div>
      <p className="md:hidden text-sm text-slate">
        The operator console is not available on a small screen.
      </p>
    </div>
  );
}
