import { TRANSITION_VARIANTS } from "@nextui-org/framer-utils";
import type { Variants } from "framer-motion";

/** NextUI's collapse, kept hidden throughout, so an interrupted height animation never shows the whole body. */
export const ACCORDION_CONTENT_MOTION: Variants = {
	enter: { ...TRANSITION_VARIANTS.collapse.enter, overflow: "hidden" },
	exit: { ...TRANSITION_VARIANTS.collapse.exit, overflow: "hidden" },
};
