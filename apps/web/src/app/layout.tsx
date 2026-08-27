import { Analytics } from "@vercel/analytics/next";
import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
// Required by MapLens (maplibre-gl): without this, marker positioning
// transforms and the map's stacking context are undefined.
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { SaveLightProvider } from "@/components/SaveLight";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-next-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-next-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-next-mono" });

export const metadata = { title: "Caesura" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/* Above the header AND the page, because the header's logo is the
            save light and the state it shows is published from inside the
            trip below (SaveLight.tsx). AppHeader itself no longer renders
            here — the (app) route group's own layout renders it, nested
            inside this provider — but the front door (/welcome, /signin,
            /signup) renders through this same slot with no AppHeader at all,
            so this provider wraps both: a save light with no consumer where
            there's no header, and the real one where (app)/layout.tsx
            supplies it. A client provider here does not make this layout a
            client component — `children` is still passed through as an
            already-rendered server tree. */}
        <SaveLightProvider>{children}</SaveLightProvider>
        <Analytics />
      </body>
    </html>
  );
}
