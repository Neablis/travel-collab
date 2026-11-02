// **The console's tab is URL state** (M36 D1): `/admin?tab=financial|users|library|ai|personas`.
//
// One module, read by the server page (which decides the body) and by the
// client strip (which navigates), so the set of tabs cannot differ between the
// two. AI models joined when M36 link 4 built it, not before, so no tab here
// was ever a placeholder.

export const CONSOLE_TABS = [
  { value: "financial", label: "Financial" },
  { value: "users", label: "Users" },
  { value: "library", label: "Library" },
  { value: "ai", label: "AI models" },
  { value: "personas", label: "Personas" },
] as const;

export type ConsoleTab = (typeof CONSOLE_TABS)[number]["value"];

/**
 * `?tab=` as the page receives it, to the tab it renders.
 *
 * An unknown or missing value renders Financial rather than a 404 (D1): a
 * stale bookmark to a tab that was renamed should land somewhere useful.
 * Next hands a repeated param as an array; the first one wins.
 */
export function resolveConsoleTab(raw: string | string[] | undefined): ConsoleTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return CONSOLE_TABS.find((tab) => tab.value === value)?.value ?? "financial";
}

/**
 * Where a tab click goes. **Only `tab`, deliberately** — switching tabs closes
 * an open account page, and dropping `account` (and every other param) is how
 * (D1).
 */
export function consoleTabHref(tab: ConsoleTab): string {
  return `/admin?tab=${tab}`;
}

/** The Personas tab's windows, in days (M57 part 6). `?days=`; the middle one is the AI models tab's fixed 30. */
export const PERSONA_WINDOWS = [7, 30, 90] as const;
export type PersonaWindow = (typeof PERSONA_WINDOWS)[number];

/** `?days=` as the page receives it; anything not offered is the default 30, as an unknown tab is Financial. */
export function resolvePersonaWindow(raw: string | string[] | undefined): PersonaWindow {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PERSONA_WINDOWS.find((days) => String(days) === value) ?? 30;
}

/** Where a window pick goes: the Personas tab at that span. */
export function personaWindowHref(days: PersonaWindow): string {
  return `${consoleTabHref("personas")}&days=${days}`;
}
