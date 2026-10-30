### KI-2026-10-30-d — `NotebookScreen.test.tsx` reads the role-gated "Show templates" filter before the role read has landed

- **Severity:** reliability. A unit test that fails on a slow runner; no product behaviour is
  wrong. Seen once on CI.
- **Area:**
  - `apps/web/src/components/pages/NotebookScreen.test.tsx`, "groups the templates by whether a
    trip comes with them, and the filter narrows to one group":
    `await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())`, then
    `screen.getByRole("radiogroup", { name: "Show templates" })`.
  - `apps/web/src/components/pages/NotebookScreen.tsx` (`role` / `mayWrite`): the template
    gallery, its filter, Blank and every Delete render only once the role read
    (`fetchTripAccess`, raced with the list) has answered.
- **Symptom / What happens:** `TestingLibraryElementError: Unable to find an accessible element
  with the role "radiogroup" and name "Show templates"`. Seen on CI for PR 641 at `b36c02d`,
  `test / unit`, a PR that does not touch this screen; the test is identical on main.
- **Cause (reported):** the test's only wait passes at once — nothing on the page renders the
  text "Loading" — so the synchronous `getByRole` runs before the role read lands whenever that
  read is slower than the first render. Reported reproduction: delay the `/access` handler 30 ms.
- **Why not fixed here:** seen on M56 part 5, which does not touch this code.
- **Fix direction:** wait for the role-gated element itself (`findByRole`) instead of the
  instant wait. Prove it red first with the 30 ms delay, green with the delay still in.
- **Cross-reference:** KI-2026-10-21-a (the same shape in e2e: a wait that proves nothing before
  a role-dependent read).
- **First noted:** 2026-10-30, CI on PR 641 at `b36c02d`.
