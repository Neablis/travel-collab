// Automatic JSX, as Next compiles it. Stated here because this is the first
// `.tsx` under `src/server`, and the integration lane's Vitest config has no
// React plugin, so it would otherwise compile these elements to a bare
// `React.createElement` with no `React` in scope.
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { CardCopy } from "./copy";
import { ogColors as c } from "./ogTokens.generated";

/** The size every link-preview card is drawn at, and the one chat apps expect. */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * Short, so a revoked invite goes generic on our side within minutes (spec
 * 2026-09-27 §2.2). An unfurler's own cache is outside our control.
 */
export const CARD_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

// Bundled, never fetched: KI-2026-09-27-a is a production deploy that failed
// because Google Fonts did not answer, and a card that fetched at request time
// would fail the same way per unfurl. Static TTF instances, because satori
// reads neither woff2 nor variable fonts. OFL, licences beside the files.
//
// `join(process.cwd(), …)` rather than `new URL(…, import.meta.url)`: it is
// the form Next's own ImageResponse docs use for the Node runtime, and the one
// its output file tracing follows into the function bundle.
const FONT_DIR = join(process.cwd(), "src/server/og/fonts");
let fonts: Promise<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]> | null = null;

function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, "BricolageGrotesque-SemiBold.ttf")),
    readFile(join(FONT_DIR, "IBMPlexSans-Regular.ttf")),
    readFile(join(FONT_DIR, "IBMPlexSans-Medium.ttf")),
  ]).then(([display, regular, medium]) => [
    { name: "Bricolage Grotesque", data: display, weight: 600 as const, style: "normal" as const },
    { name: "IBM Plex Sans", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "IBM Plex Sans", data: medium, weight: 500 as const, style: "normal" as const },
  ]);
  return fonts;
}

// The static site card's language (`scripts/generate-og-assets.mjs`): moss
// ground, the contour grid and its river, the ◎ mark on a brand square, and
// the display face for the headline.
/** Draw one preview card as a 1200×630 PNG response with the preview cache header. */
export async function renderCard(copy: CardCopy): Promise<ImageResponse> {
  // A trip name is the user's, and can be long; the headline steps down a size
  // rather than being cut, and clamps at three lines past that.
  const headlineSize = copy.title.length > 70 ? 52 : 64;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: c.moss,
          color: c.ink,
          fontFamily: "IBM Plex Sans",
        }}
      >
        <svg
          width={CARD_SIZE.width}
          height={CARD_SIZE.height}
          viewBox="0 0 160 84"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <path d="M-6 22 L 166 18" stroke={c.hairline} strokeWidth="0.4" />
          <path d="M-6 44 L 166 41" stroke={c.hairline} strokeWidth="0.4" />
          <path d="M-6 66 L 166 62" stroke={c.hairline} strokeWidth="0.4" />
          <path d="M124 -6 L 130 90" stroke={c.hairline} strokeWidth="0.4" />
          <path d="M140 -6 C 136 18, 148 34, 143 52 S 152 74, 148 90" stroke={c.infoTint} strokeWidth="3.2" />
        </svg>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 960,
            padding: "72px 0 72px 84px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: c.brand,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="10" stroke={c.surface} strokeWidth="2.4" />
                <circle cx="16" cy="16" r="4.4" stroke={c.surface} strokeWidth="2.4" />
              </svg>
            </div>
            <div style={{ fontSize: 28, fontWeight: 500, color: c.slate }}>{copy.label}</div>
          </div>
          <div
            style={{
              display: "block",
              fontFamily: "Bricolage Grotesque",
              fontWeight: 600,
              fontSize: headlineSize,
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
              lineClamp: 3,
            }}
          >
            {copy.title}
          </div>
          <div style={{ display: "flex", fontSize: 30, lineHeight: 1.4, color: c.slate }}>{copy.description}</div>
        </div>
      </div>
    ),
    { ...CARD_SIZE, fonts: await loadFonts(), headers: { "Cache-Control": CARD_CACHE_CONTROL } },
  );
}
