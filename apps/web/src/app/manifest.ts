import type { MetadataRoute } from "next";
import { appColors } from "@/lib/appColors.generated";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/siteMetadata";

// M39 Part 4 (D4, D10): what makes Caesura installable — Chrome's *Install
// Caesura* and Android's home-screen icon both read this file, and iOS 16.4+
// takes `display` from it. The icons are committed PNGs from
// `scripts/generate-og-assets.mjs`; the colours are generated from globals.css
// (`appColors.generated.ts`), because the colour wall keeps literals out of
// every other file.
//
// `theme_color` is AppHeader's background, so the OS bar above the app meets
// the header without a seam; `background_color` is the page's, so the splash
// screen is the colour the first paint is. The root layout's `viewport` sets
// the same `theme-color` for the browser tab.
/** `/manifest.webmanifest`: the installed app's name, colours and icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    theme_color: appColors.surface,
    background_color: appColors.paper,
    icons: [
      { src: "/icons/icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
