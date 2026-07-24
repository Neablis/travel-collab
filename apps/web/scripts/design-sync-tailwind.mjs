import postcss from '/Users/mitchelldemarco/Claude/Projects/travel-collab/node_modules/.pnpm/postcss@8.5.16/node_modules/postcss/lib/postcss.mjs';
import tailwindcss from '@tailwindcss/postcss';
import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve('src/app/globals.css');
const outputPath = path.resolve('.ds-compiled.css');
const css = fs.readFileSync(inputPath, 'utf8');

// next/font/google assigns --font-next-{display,sans,mono} to hashed local
// family names at runtime — nothing static for the sync to pick up. Bridge
// them to the real self-hosted families shipped via cfg.extraFonts
// (.design-sync/fonts-src/fonts.css) so var(--font-next-*) resolves outside
// the Next.js app.
const fontBridge = `
:root {
  --font-next-display: 'Bricolage Grotesque', ui-sans-serif, sans-serif;
  --font-next-sans: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --font-next-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
`;

postcss([tailwindcss()])
  .process(css, { from: inputPath, to: outputPath })
  .then((result) => {
    fs.writeFileSync(outputPath, result.css + '\n' + fontBridge);
    console.log('wrote', outputPath, (result.css.length / 1024).toFixed(1) + 'KB');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
