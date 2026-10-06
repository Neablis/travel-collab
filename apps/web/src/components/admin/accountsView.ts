// **The accounts table's view is URL state** (M36 D2): `q`, `filter` and `page`
// under `/admin?tab=users`, so the account page's *← All accounts* returns with
// them kept.
//
// One module, read by the server page (which seeds the panel from
// `searchParams`) and by the client panel (which writes the URL back and builds
// each row's link), so the two cannot disagree about a param's name or default.

/**
 * **Filter ids say what the group MEANS, never a plan id** — they were `"free"`
 * and `"paid"` once, and `planVersions.fourthPlan.test.ts` flagged `case
 * "free":` (ADR-045 rule 4; `building-from-the-design.md`, *Design ids are not
 * domain ids*). The artboard's `free` / `past_due` / `under` are renamed for
 * the same reason; they also become the `?filter=` values, which is one more
 * place a plan-id-shaped string would have leaked.
 */
export const ACCOUNT_FILTERS = [
  { id: "all", label: "All" },
  { id: "paying", label: "Paying" },
  { id: "granted", label: "Granted" },
  { id: "unentitled", label: "Free" },
  { id: "pastDue", label: "Past due" },
  { id: "underwater", label: "Costs more than it pays" },
] as const;

export type AccountFilter = (typeof ACCOUNT_FILTERS)[number]["id"];

/** The table's view. `page` is zero-based here and one-based in the URL. */
export interface AccountsView {
  query: string;
  filter: AccountFilter;
  page: number;
}

type Param = string | string[] | undefined;
const first = (raw: Param) => (Array.isArray(raw) ? raw[0] : raw);

/**
 * `searchParams` to a view. An unknown filter or a page that is not a positive
 * integer falls back to the default rather than erroring — a stale or
 * hand-edited link should still land on the table.
 */
export function resolveAccountsView(params: Record<string, Param>): AccountsView {
  const filter = first(params.filter);
  const page = Number(first(params.page));
  return {
    query: first(params.q) ?? "",
    filter: ACCOUNT_FILTERS.find((option) => option.id === filter)?.id ?? "all",
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
  };
}

/**
 * The Users tab's URL for a view, and for one account's page when `account` is
 * given. Defaults are left out, so a fresh table is plain `?tab=users`.
 */
export function accountsViewHref(view: AccountsView, account?: string): string {
  const params = new URLSearchParams({ tab: "users" });
  if (account !== undefined) params.set("account", account);
  if (view.query !== "") params.set("q", view.query);
  if (view.filter !== "all") params.set("filter", view.filter);
  if (view.page > 0) params.set("page", String(view.page + 1));
  return `/admin?${params.toString()}`;
}
