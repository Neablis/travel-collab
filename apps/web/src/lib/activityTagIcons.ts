import {
  BedDouble,
  Camera,
  Drama,
  Flower2,
  Landmark,
  MoonStar,
  Mountain,
  Route,
  ShoppingBag,
  TicketCheck,
  TreePalm,
  Trophy,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from "lucide-react";
import type { ActivityTag } from "@tc/contracts";

/**
 * One icon per activity tag, drawn beside its tint on every tag chip (M56 D8).
 *
 * Exhaustive on purpose, as `MODE_DISPLAY` is: a fifteenth tag in the contract
 * fails to compile here rather than rendering a chip with no icon, and
 * `activityTags.test.ts` holds that no two tags share one. `TicketCheck`, not
 * `Ticket`, because the pending reason "To book" already wears that.
 */
export const ACTIVITY_TAG_ICON: Record<ActivityTag, LucideIcon> = {
  meal: UtensilsCrossed,
  lodging: BedDouble,
  ticketed: TicketCheck,
  outdoors: Mountain,
  drinks: Wine,
  nightlife: MoonStar,
  museum: Landmark,
  sight: Camera,
  beach: TreePalm,
  shopping: ShoppingBag,
  show: Drama,
  tour: Route,
  wellness: Flower2,
  sports: Trophy,
};
