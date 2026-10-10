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
 *   place's own coordinates when the link carries them (a search link's map
 *   centre is not the place's). The link itself goes into the notes.
 * - An Apple Maps link with `name` (or `q`, or `address`) and `coordinate`
 *   (or `ll`) gives the same.
 * - A Google directions link or bare map view is a link, not a place.
 * - A short link or any other web link goes into the notes, and the title is
 *   left empty.
 * - Plain text: its first line is the title, and any further lines are the
 *   notes, after whatever of the first line did not fit in the title.
 */
export function pasteToStop(text: string): PastedStop | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const url = asWebUrl(trimmed);
  if (url !== null) {
    // A place keeps its link in the notes too, so what was pasted is not lost
    // when the name or the coordinates were read wrong.
    const found = googleMaps(url) ?? appleMaps(url);
    return { ...(found ?? { title: "" }), notes: clip(trimmed, NOTES_MAX) };
  }

  // Whatever of the first line does not fit in the title leads the notes.
  const [first = "", ...rest] = trimmed.split(/\r?\n/).filter((line) => line.trim() !== "");
  const line = first.trim();
  const title = clip(line, TITLE_MAX);
  const notes = [line.slice(title.length).trim(), ...rest].join("\n").trim();
  return { title, ...(notes !== "" && { notes: clip(notes, NOTES_MAX) }) };
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
  // `google.com`, a country's `google.de`, or `google.co.jp` / `google.com.au`,
  // and nothing after it, so `maps.google.evil.com` is not Google.
  const isGoogle = /(^|\.)google\.(com|[a-z]{2})(\.[a-z]{2})?$/.test(host);
  if (!isGoogle || !(host.startsWith("maps.") || url.pathname.startsWith("/maps"))) return null;

  // `/maps/place/<name>/@lat,lng,zoom/data=…!3d<lat>!4d<lng>…`. The `@` pair
  // is where the map was centred when the link was copied, and the `!3d…!4d`
  // pair is the place itself, so that one wins when both are there. A place
  // link's map is centred on the place, but a search link's is wherever the
  // map sat when the search ran, so only a place's `@` pair is used.
  //
  // Only a place or a search names somewhere. Directions (`/maps/dir/…`) and
  // a bare map view (`/maps/@lat,lng,zoom`) carry an `@` too, but that is
  // only where the map was scrolled to, so they are links and not places.
  const segments = url.pathname.split("/");
  const named = segments.findIndex((s) => s === "place" || s === "search");
  const pathName = named === -1 ? undefined : segments[named + 1];
  const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
  if (named === -1 && query === undefined) return null;
  const rawName = pathName !== undefined && pathName !== "" && !pathName.startsWith("@") ? decodePart(pathName) : (query ?? "").trim();

  // A dropped pin is named by its coordinates, in degrees and minutes when
  // Google names it ("35°00'41.8"N 135°46'05.2"E"), and that is no title.
  const dms = dmsCoords(rawName);
  const name = dms === undefined ? rawName : "";

  const pinned = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url.pathname);
  const centred = segments[named] === "place" ? /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname) : null;
  const coords =
    coordsFrom(pinned) ?? coordsFrom(centred) ?? coordsFrom(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(name)) ?? dms ?? null;
  return place(name, coords);
}

/**
 * Coordinates written in degrees, minutes and seconds, as Google names a
 * dropped pin: `undefined` when the text is not that shape at all, `null`
 * when it is but the numbers are no place.
 */
function dmsCoords(text: string): { lat: number; lng: number } | null | undefined {
  const m = /^(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2}(?:\.\d+)?)"\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2}(?:\.\d+)?)"\s*([EW])$/i.exec(text);
  if (m === null) return undefined;
  const degrees = (d: string, min: string, sec: string, hemisphere: string) =>
    (Number(d) + Number(min) / 60 + Number(sec) / 3600) * (/[SW]/i.test(hemisphere) ? -1 : 1);
  const lat = degrees(m[1]!, m[2]!, m[3]!, m[4]!);
  const lng = degrees(m[5]!, m[6]!, m[7]!, m[8]!);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

function appleMaps(url: URL): PastedStop | null {
  if (url.hostname.toLowerCase() !== "maps.apple.com") return null;
  // Today's share links (`/place?address=…&coordinate=…&name=…`) carry no `q`
  // and no `ll`; older ones carry only those. The place's own name comes
  // before its street address either way.
  const params = url.searchParams;
  const name = (params.get("name") ?? params.get("q") ?? params.get("address") ?? "").trim();
  const coords = coordsFrom(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(params.get("coordinate") ?? params.get("ll") ?? ""));
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
