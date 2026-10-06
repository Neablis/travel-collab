// Deep links into Trip settings (M37 part 4). Home's unplanned card offers
// *Invite who's coming* and *Choose a cover photo*, and both land on a section
// of a sheet that lives on the trip page. The header already opened the sheet
// at People from its avatar stack (travellers spec D10) — a URL is the same
// state reached from another page.

/** The Trip settings sections a link may open the sheet at. */
export const SETTINGS_SECTIONS = ["people", "cover"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const PARAM = "settings";

/** `/trips/<id>?settings=<section>`: the trip, with Trip settings open at `section`. */
export function tripSettingsHref(tripId: string, section: SettingsSection): string {
  return `/trips/${tripId}?${PARAM}=${section}`;
}

/**
 * The section a URL's query asks Trip settings to open at, or null for none.
 * An unknown value is null rather than the sheet's top: a link that names a
 * section this build does not have should not open anything.
 */
export function settingsSectionFrom(search: string): SettingsSection | null {
  const value = new URLSearchParams(search).get(PARAM);
  return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? "") ? (value as SettingsSection) : null;
}

/** `search` without the settings param, `?`-prefixed, or "" when nothing is left. */
export function withoutSettingsParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PARAM);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
