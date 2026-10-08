import type { AvatarKey } from "@tc/contracts";
import {
  Bike,
  Camera,
  Coffee,
  Compass,
  Map,
  Mountain,
  Plane,
  Sailboat,
  Sun,
  Tent,
  TrainFront,
  TreePalm,
  type LucideIcon,
} from "lucide-react";

// M38 D1: the key is what is stored, the icon name is not, so this map is the
// only place the two meet. A `Record` rather than a switch so a key added to
// the contract fails `tsc` here instead of rendering an empty chip.
/** The lucide glyph `PersonChip` draws for each stored avatar key. */
export const AVATAR_GLYPHS: Record<AvatarKey, LucideIcon> = {
  compass: Compass,
  mountain: Mountain,
  palm: TreePalm,
  plane: Plane,
  tent: Tent,
  sailboat: Sailboat,
  camera: Camera,
  map: Map,
  sun: Sun,
  bike: Bike,
  train: TrainFront,
  coffee: Coffee,
};
