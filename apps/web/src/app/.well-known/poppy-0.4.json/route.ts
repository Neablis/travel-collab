import { metadataJson, preflight } from "@/server/oauth/errors";
import { poppyDocument04 } from "@/server/poppy/discovery";

// **`GET /.well-known/poppy-0.4.json`** (Personal Agent Protocol 1.0, spec
// 3.4). The 0.4 document `poppy.json`'s `supported_versions` links to: the
// same body pinned at 0.4, with no `supported_versions` of its own. Takes no
// request: the document names the configured origin, never the `Host` header
// (ADR-083 amendment B).

/** The 0.4 discovery document, identical for every caller. */
export function GET(_request?: Request) {
  return metadataJson(poppyDocument04());
}

export const OPTIONS = preflight;
