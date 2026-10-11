"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { AttachedItem } from "./AskAbout";
import { AttachedItemChip } from "./AttachedItemChip";

/** The attached publication above the message box. Its row opens and closes in height, so the box below it slides rather than jumps. */
export function AttachedRow({ item, onRemove, onHeightChange }: { item: AttachedItem | null; onRemove: () => void; onHeightChange?: () => void }) {
	const instant = useReducedMotion();
	return (
		<AnimatePresence initial={false}>
			{item && (
				<motion.div
					key="attached"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={instant ? { duration: 0 } : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
					onAnimationComplete={onHeightChange}
					className="overflow-hidden"
				>
					<div className="flex px-2 pb-1 pt-1.5">
						{/* A new publication replaces the chip in place: its key is the publication. */}
						<AttachedItemChip key={item.key} item={item} onRemove={onRemove} />
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
