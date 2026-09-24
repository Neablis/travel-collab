import { discoverPlaybooksDef } from "@/server/public-api/discover";
import { route } from "@/server/public-api/route";

// **Discover over v1** (ADR-050, Pass C): published Playbooks from everyone,
// ranked and filtered by the same predicates the app's Discover page uses.
// Under `/discover/` rather than `/playbooks/` because `GET /v1/playbooks` is
// YOUR Playbooks, and a query parameter that turned it into everybody's would
// be two resources behind one URL.
export const { GET } = route({ GET: discoverPlaybooksDef });
