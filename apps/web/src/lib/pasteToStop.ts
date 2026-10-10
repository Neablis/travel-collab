// M41 D8: what a paste or a drop onto a day turns into. It replaces quick-add
// and search-to-add, and it never goes to the model: the result only prefills
// the editor, and the person reviews it there before `AddActivity` is sent.
//
// **Google Maps short links (`maps.app.goo.gl`) are not followed.** Following
// one needs a server request to Google for each paste, and the redirect target
// is not a documented API. So the link goes into the notes, the title is left
// for the person to type, and following short links is filed in
// `docs/candidates.md`.

/** What a pasted string prefills in the editor. */
export type PastedStop = {
  title: string;
  location?: { name: string; lat?: number; lng?: number };
  notes?: string;
};

const TITLE_MAX = 200; // ActivityCommand's title and Location's name (contracts/activity.ts)
const NOTES_MAX = 2000;

/**
 * Turns pasted or dropped text into an editor prefill, or `null` when there is
 * nothing in it.
 *
 * - A Google Maps place or search link gives a title and a place, with the
 *   place's own coordinates when the link carries them.
 * - An Apple Maps link with `q` (or `address`) and `ll` gives the same.
 * - A short link or any other web link goes into the notes, and the title is
 *   left empty.
 * - Plain text: its first line is the title, and any further lines are the
 *   notes.
 */
export function pasteToStop(text: string): PastedStop | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const url = asWebUrl(trimmed);
  if (url !== null) return googleMaps(url) ?? appleMaps(url) ?? { title: "", notes: clip(trimmed, NOTES_MAX) };

  const [first = "", ...rest] = trimmed.split(/\r?\n/).filter((line) => line.trim() !== "");
  const notes = rest.join("\n").trim();
  return { title: clip(first.trim(), TITLE_MAX), ...(notes !== "" && { notes: clip(notes, NOTES_MAX) }) };
}

function asWebUrl(text: string): URL | null {
  if (/\s/.test(text) || !/^https?:\/\//i.test(text)) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function googleMaps(url: URL): PastedStop | null {
  const host = url.hostname.toLowerCase();
  const isGoogle = /(^|\.)google\.[a-z.]+$/.test(host);
  if (!isGoogle || !(host.startsWith("maps.") || url.pathname.startsWith("/maps"))) return null;

  // `/maps/place/<name>/@lat,lng,zoom/data=…!3d<lat>!4d<lng>…`. The `@` pair
  // is where the map was centred when the link was copied, and the `!3d…!4d`
  // pair is the place itself, so that one wins when both are there.
  const segments = url.pathname.split("/");
  const named = segments.findIndex((s) => s === "place" || s === "search");
  const pathName = named === -1 ? undefined : segments[named + 1];
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
  const name = pathName !== undefined && pathName !== "" && !pathName.startsWith("@") ? decodePart(pathName) : (query ?? "").trim();

  const pinned = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const centred = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const coords = coordsFrom(pinned) ?? coordsFrom(centred) ?? coordsFrom(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(name));
  return place(name, coords);
}

function appleMaps(url: URL): PastedStop | null {
  if (url.hostname.toLowerCase() !== "maps.apple.com") return null;
  const name = (url.searchParams.get("q") ?? url.searchParams.get("address") ?? "").trim();
  const coords = coordsFrom(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(url.searchParams.get("ll") ?? ""));
  return place(name, coords);
}

/**
 * A place from a name and coordinates. A name that is only coordinates titles
 * nothing, as a Map double-click titles nothing, and a link with neither is
 * not a place.
 */
function place(name: string, coords: { lat: number; lng: number } | null): PastedStop | null {
  const isCoords = /^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(name);
  if (name === "" || isCoords) {
    if (coords === null) return null;
    return { title: "", location: { name: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`, ...coords } };
  }
  // Google often names a place with its address after it ("Ichiran Shibuya,
  // 1 Chome-22-7 Jinnan, …"). The place keeps all of it, and the title takes
  // the part before the first comma.
  const title = clip(name.split(",")[0]?.trim() || name, TITLE_MAX);
  return { title, location: { name: clip(name, TITLE_MAX), ...(coords ?? {}) } };
}

function coordsFrom(match: RegExpExecArray | null): { lat: number; lng: number } | null {
  if (match === null) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function decodePart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, " ")).trim();
  } catch {
    return part.replace(/\+/g, " ").trim();
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}
