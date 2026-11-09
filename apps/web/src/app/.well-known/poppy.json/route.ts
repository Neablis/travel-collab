import { metadataJson, preflight } from "@/server/oauth/errors";
import { poppyDocument } from "@/server/poppy/discovery";

// **`GET /.well-known/poppy.json`** (Personal Agent Protocol, spec 3). Takes no
// request: the document names the configured origin, never the `Host` header
// (ADR-083 amendment B).

/** The Poppy discovery document, identical for every caller. */
export function GET(_request?: Request) {
  return metadataJson(poppyDocument());
}

export const OPTIONS = preflight;
