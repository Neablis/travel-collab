import { GET as getAccount } from "@/app/api/v1/account/route";
import { GET as searchCities } from "@/app/api/v1/cities/route";
import { GET as discoverPlaybooks } from "@/app/api/v1/discover/playbooks/route";
import { GET as searchPlaces } from "@/app/api/v1/geocode/route";
import { PATCH as movePlaybookCover, PUT as setPlaybookCover } from "@/app/api/v1/playbooks/[playbookId]/cover/route";
import { GET as getPlaybook, PATCH as patchPlaybook } from "@/app/api/v1/playbooks/[playbookId]/route";
import { GET as listPlaybooks, POST as createPlaybook } from "@/app/api/v1/playbooks/route";
import { PATCH as moveTripCover, PUT as setTripCover } from "@/app/api/v1/trips/[tripId]/cover/route";
import { GET as getPage, PATCH as patchPage } from "@/app/api/v1/trips/[tripId]/pages/[pageId]/route";
import { GET as listPages } from "@/app/api/v1/trips/[tripId]/pages/route";
import { GET as getTrip } from "@/app/api/v1/trips/[tripId]/route";
import { GET as listTrips } from "@/app/api/v1/trips/route";
import { withPublicUrl } from "@/server/mcp/publishUrl";
import type { McpTool } from "@/server/mcp/tools";

// **The connector's tools: each one row naming the v1 handler it adapts**
// (ADR-083 §8, M55 D2 and D4). A tool owns its name, its words for a model and
// its hints. Everything else (the scope, the role gate, the schema, the errors,
// the rate limit) is the declared handler's, so a tool can do exactly what a
// token with the same scopes can, through the same code.
// `server/mcp/conformance.test.ts` holds every row to that.
//
// It sits beside the route, not in `server/mcp/`, because it imports v1 route
// modules, and `server/**` never imports `app/**` (`pnpm arch`).
//
// **No deletes** (D4): nothing a connected app can do removes anything.

const PLAYBOOK =
  "A Playbook is a public day plan in Caesura's Discover library (or a private one of yours until it is published): " +
  "one or more days, each an ordered list of stops. Reads return stops flat, with a 0-based `dayIndex` on each; " +
  "writes take them grouped as `days[].stops[]`.";

const READ = { readOnlyHint: true, openWorldHint: false } as const;

const COVER_URL =
  "Give the address of an image on the open web (the image file itself, not a page that shows it), " +
  "its alt text, and who to credit. Caesura checks the address answers with an image before keeping it.";

// Setting replaces the cover there was, and Caesura fetches the image from its host.
const SET_COVER = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const;
// Moving changes the framing only, and the old framing is one more call away.
const MOVE_COVER = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const POSITION = "`position` frames the photo vertically: 0 shows its top edge, 100 its bottom, 50 its centre.";

export const TOOLS: readonly McpTool[] = [
  {
    name: "whoami",
    title: "Who am I",
    description: "Show which Caesura account this connection acts as: its user id, plan and entitlements.",
    handler: getAccount,
    path: "/api/v1/account",
    annotations: READ,
  },
  {
    name: "search_places",
    title: "Search places",
    description:
      "Search for a real place by name and get up to five locations, each ready to use as a stop's `location`. " +
      "Each call spends the account's daily place-search allowance, so search once per place.",
    handler: searchPlaces,
    path: "/api/v1/geocode",
    // It asks the outside geocoder, whose answers are not ours.
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "search_library_cities",
    title: "Search library cities",
    description:
      "Find city names in the published Playbook library by prefix, with how many published days touch each. " +
      "Use the exact spelling it returns as `city` in list_discover_playbooks.",
    handler: searchCities,
    path: "/api/v1/cities",
    annotations: READ,
  },
  {
    name: "list_discover_playbooks",
    title: "List Discover Playbooks",
    description: `List published Playbooks from everyone, filtered by city, country, length or rating. ${PLAYBOOK}`,
    handler: discoverPlaybooks,
    path: "/api/v1/discover/playbooks",
    annotations: READ,
  },
  {
    name: "list_my_playbooks",
    title: "List my Playbooks",
    description: `List the Playbooks this account has made or kept, newest first, optionally only public or private ones. ${PLAYBOOK}`,
    handler: listPlaybooks,
    path: "/api/v1/playbooks",
    annotations: READ,
  },
  {
    name: "get_playbook",
    title: "Get a Playbook",
    description: `Read one Playbook (yours, or anyone's published one) with every day and stop in order. ${PLAYBOOK}`,
    handler: getPlaybook,
    path: "/api/v1/playbooks/{playbookId}",
    annotations: READ,
  },
  {
    name: "create_playbook",
    title: "Create a Playbook",
    description:
      `Create a private Playbook, written inline as days of stops, or kept from days of one of your trips. ${PLAYBOOK} ` +
      "It starts private: call publish_playbook to put it in Discover. Calling again with the same input " +
      "within a day returns the Playbook already made rather than a second one.",
    handler: createPlaybook,
    path: "/api/v1/playbooks",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "update_playbook",
    title: "Update a Playbook",
    description:
      `Change one of your Playbooks: its name, its summary (null clears it), or all of its days at once. ${PLAYBOOK} ` +
      "Send at least one of name, summary or days, and always the `expectedVersion` you last read; a stale " +
      "version is refused, so read the Playbook again and resend. Days replace every existing day and stop, " +
      "and only while the Playbook is private: to change a published one, unpublish it, update it, and publish it again.",
    handler: patchPlaybook,
    path: "/api/v1/playbooks/{playbookId}",
    offers: ["name", "summary", "days", "expectedVersion"],
    // Days replace what was there; nothing else this connector does overwrites.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "publish_playbook",
    title: "Publish a Playbook",
    description:
      "Publish one of your Playbooks to Discover, where anyone can find, read and review it. " +
      "Answers the Playbook and its public `url`.",
    handler: patchPlaybook,
    path: "/api/v1/playbooks/{playbookId}",
    offers: [],
    fixed: { visibility: "public" },
    answer: withPublicUrl,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "unpublish_playbook",
    title: "Unpublish a Playbook",
    description: "Take one of your published Playbooks out of Discover; it stays yours, private.",
    handler: patchPlaybook,
    path: "/api/v1/playbooks/{playbookId}",
    offers: [],
    fixed: { visibility: "private" },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "set_playbook_cover",
    title: "Set a Playbook's cover photo",
    description: `Set the cover photo of one of your Playbooks, replacing any it had. ${COVER_URL} ${POSITION}`,
    handler: setPlaybookCover,
    path: "/api/v1/playbooks/{playbookId}/cover",
    annotations: SET_COVER,
  },
  {
    name: "move_playbook_cover",
    title: "Reposition a Playbook's cover photo",
    description: `Move where the cover photo of one of your Playbooks is framed, without changing the photo. ${POSITION}`,
    handler: movePlaybookCover,
    path: "/api/v1/playbooks/{playbookId}/cover",
    annotations: MOVE_COVER,
  },
  {
    name: "list_trips",
    title: "List my trips",
    description: "List the trips this account owns or is a member of, optionally only those under way today.",
    handler: listTrips,
    path: "/api/v1/trips",
    annotations: READ,
  },
  {
    name: "get_trip",
    title: "Get a trip",
    description: "Read one trip with its days, stops, members and conflicts.",
    handler: getTrip,
    path: "/api/v1/trips/{tripId}",
    annotations: READ,
  },
  {
    name: "set_trip_cover",
    title: "Set a trip's cover photo",
    description: `Set the cover photo of a trip you can edit, replacing any it had. ${COVER_URL} ${POSITION}`,
    handler: setTripCover,
    path: "/api/v1/trips/{tripId}/cover",
    annotations: SET_COVER,
  },
  {
    name: "move_trip_cover",
    title: "Reposition a trip's cover photo",
    description: `Move where the cover photo of a trip you can edit is framed, without changing the photo. ${POSITION}`,
    handler: moveTripCover,
    path: "/api/v1/trips/{tripId}/cover",
    annotations: MOVE_COVER,
  },
  {
    name: "list_notebook_pages",
    title: "List a trip's Notebook pages",
    description: "List the Notebook pages (research notes, packing lists and the like) on one of your trips.",
    handler: listPages,
    path: "/api/v1/trips/{tripId}/pages",
    annotations: READ,
  },
  {
    name: "get_notebook_page",
    title: "Get a Notebook page",
    description: "Read one Notebook page on a trip.",
    handler: getPage,
    path: "/api/v1/trips/{tripId}/pages/{pageId}",
    annotations: READ,
  },
  {
    name: "update_notebook_page",
    title: "Update a Notebook page",
    description: "Change a Notebook page on a trip you can edit. The fields you send replace what was there.",
    handler: patchPage,
    path: "/api/v1/trips/{tripId}/pages/{pageId}",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];
