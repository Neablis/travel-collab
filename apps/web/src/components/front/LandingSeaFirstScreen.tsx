import { FIRST_SCREEN, GroundCell } from "./LandingSeaCells";

// The first screen's cells as a server component: no hooks, no packer, CSS
// places them. `LandingScreen` renders this and passes it into `LandingSea`
// as a prop, so the first screen is in the server's HTML and is never
// hydrated — the cards inside still hydrate as client leaves
// (`DiscoverCard` reads the time-format context), but the cell shells, the
// labels and the accents do not. The packed bands below stay client: their
// cells depend on the measured column count, which only the client knows.
/** The sea's first screen, server-rendered: the cells CSS packs around the hero. */
export function LandingSeaFirstScreen() {
  return (
    <>
      {FIRST_SCREEN.map((ground, i) => (
        <GroundCell key={i} ground={ground} />
      ))}
    </>
  );
}
