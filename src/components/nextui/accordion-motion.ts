import { TRANSITION_VARIANTS } from "@nextui-org/framer-utils";
import type { Variants } from "framer-motion";

/** NextUI's collapse, kept hidden throughout, so an interrupted height animation never shows the whole body. */
export const ACCORDION_CONTENT_MOTION: Variants = {
	enter: { ...TRANSITION_VARIANTS.collapse.enter, overflow: "hidden" },
	exit: { ...TRANSITION_VARIANTS.collapse.exit, overflow: "hidden" },
};

/** An accordion of questions: each question in bold, a muted summary under it, and its answer in small text. */
export const QUESTION_ITEM = {
	base: "px-0",
	trigger: "gap-4 py-4 data-[focus-visible=true]:outline-accent",
	title: "font-semibold leading-6",
	subtitle: "mt-0.5 text-sm leading-6 text-black/60 dark:text-white/60",
	indicator: "text-black/40 dark:text-white/40",
	content: "pb-5 pt-0 text-sm leading-6 text-black/70 dark:text-white/70",
};
