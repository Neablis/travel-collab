import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
// Required by MapLens (maplibre-gl): without this, marker positioning
// transforms and the map's stacking context are undefined, causing
// mispositioned/misbehaving markers and z-index issues with content
// rendered after the map.
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata = { title: "travel-collab" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: "2rem" }}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
