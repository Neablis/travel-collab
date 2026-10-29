import localFont from "next/font/local";

// The three faces (docs/guidelines/design-system.md), from files committed in
// `./fonts/` rather than fetched from Google at build time.
//
// WHY LOCAL (KI-2026-09-27-a). `next/font/google` downloads the files from
// fonts.googleapis.com / fonts.gstatic.com during `next build`. When Google did
// not answer, a production deploy of `main` failed at its build step and
// production silently stayed one merge behind. Committed files make the build
// fetch nothing.
//
// WHERE THE FILES COME FROM. Fontsource 5.3.0 (`@fontsource-variable/
// bricolage-grotesque`, `@fontsource-variable/ibm-plex-sans`,
// `@fontsource/ibm-plex-mono`), which repackages Google's own files; all three
// are SIL OFL 1.1, and each license sits beside its files. The shape matches
// what `next/font/google` emitted before: one variable `wght` file per subset
// for Bricolage Grotesque and IBM Plex Sans, static 400/500 files for IBM Plex
// Mono.
//
// WHY ONE CALL PER SUBSET. Google's CSS splits each family into unicode-range
// subsets, so a page downloads latin and nothing else unless it shows, say,
// "Łódź" (latin-ext) or "Đà Nẵng" (vietnamese). `next/font/local` puts its
// `declarations` on every face of a call, so each subset is its own call with
// its own `unicode-range`, and so its own generated family. Only latin
// preloads, as before. Naming one shared family in `declarations` does not
// work: the build then points the call's CSS variable at the generated name,
// which no face carries (tried 2026-10-28).
//
// HOW THEY BECOME ONE FAMILY AGAIN. Each call sets a per-subset variable, and
// globals.css (`:root`, "The three faces") lists them into the variables every
// consumer reads, `--font-next-display`, `--font-next-sans` and
// `--font-next-mono`, unchanged in name. The non-latin subsets come first: a
// family whose unicode-range misses a character is skipped without a download,
// and the latin call's metric-matched Arial fallback, the only fallback face
// (the others set `adjustFontFallback: false`), must stay last or it would
// catch "Ł" before latin-ext could.
//
// Every argument is a literal, ranges repeated: the font loader reads the call
// statically and refuses a reference to a const.

const display = localFont({
  src: "./fonts/bricolage-grotesque-latin-wght-normal.woff2",
  weight: "500 600",
  variable: "--font-next-display-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
const displayLatinExt = localFont({
  src: "./fonts/bricolage-grotesque-latin-ext-wght-normal.woff2",
  weight: "500 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-display-latin-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
const displayVietnamese = localFont({
  src: "./fonts/bricolage-grotesque-vietnamese-wght-normal.woff2",
  weight: "500 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-display-vietnamese",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});

const sans = localFont({
  src: "./fonts/ibm-plex-sans-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-next-sans-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
const sansLatinExt = localFont({
  src: "./fonts/ibm-plex-sans-latin-ext-wght-normal.woff2",
  weight: "400 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-sans-latin-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
const sansVietnamese = localFont({
  src: "./fonts/ibm-plex-sans-vietnamese-wght-normal.woff2",
  weight: "400 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-sans-vietnamese",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});
const sansCyrillic = localFont({
  src: "./fonts/ibm-plex-sans-cyrillic-wght-normal.woff2",
  weight: "400 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-sans-cyrillic",
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});
const sansCyrillicExt = localFont({
  src: "./fonts/ibm-plex-sans-cyrillic-ext-wght-normal.woff2",
  weight: "400 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-sans-cyrillic-ext",
  declarations: [
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});
const sansGreek = localFont({
  src: "./fonts/ibm-plex-sans-greek-wght-normal.woff2",
  weight: "400 600",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-sans-greek",
  declarations: [
    { prop: "unicode-range", value: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF" },
  ],
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--font-next-mono-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
const monoLatinExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-ext-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-ext-500-normal.woff2", weight: "500" },
  ],
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-mono-latin-ext",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
const monoVietnamese = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-vietnamese-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-vietnamese-500-normal.woff2", weight: "500" },
  ],
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-mono-vietnamese",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
  ],
});
const monoCyrillic = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-cyrillic-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-cyrillic-500-normal.woff2", weight: "500" },
  ],
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-mono-cyrillic",
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});
const monoCyrillicExt = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-cyrillic-ext-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-cyrillic-ext-500-normal.woff2", weight: "500" },
  ],
  preload: false,
  adjustFontFallback: false,
  variable: "--font-next-mono-cyrillic-ext",
  declarations: [
    { prop: "unicode-range", value: "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F" },
  ],
});

/** Every subset's variable class, for <html>, where globals.css composes them. */
export const fontVariables = [
  display,
  sans,
  mono,
  displayLatinExt,
  displayVietnamese,
  sansLatinExt,
  sansVietnamese,
  sansCyrillic,
  sansCyrillicExt,
  sansGreek,
  monoLatinExt,
  monoVietnamese,
  monoCyrillic,
  monoCyrillicExt,
]
  .map((face) => face.variable)
  .join(" ");
