# Third-party data

Data this repository ships or derives, with its source and licence. Code
dependencies carry their own licences in `node_modules`; this file is for
DATA, where an attribution is owed by the licence or is simply the honest
thing to say.

## Time zones (M14 link 11)

- **Time zone boundaries** — [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder)
  by Evan Siroky, made available under the
  [Open Database License (ODbL-1.0)](https://opendatacommons.org/licenses/odbl/1-0/).
  Reached two ways:
  - at runtime, through [`@photostructure/tz-lookup`](https://github.com/photostructure/tz-lookup)
    (CC0-1.0), whose compressed lookup is built from it — `apps/web/src/server/timeZones.ts`;
  - offline, through [`geo-tz`](https://github.com/evansiroky/node-geo-tz) (MIT), to generate
    `apps/web/src/server/airportTimeZones.generated.ts`. That table is a
    database derived from timezone-boundary-builder and is made available
    under the same ODbL-1.0.
- **Airports** — [OurAirports](https://ourairports.com/data/) `airports.csv`,
  dedicated to the public domain by its maintainers. Codes and coordinates
  feed the generated table above.
