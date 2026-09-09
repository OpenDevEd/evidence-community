"use client";
import useSWR from "swr";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { InboxIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { getAdminReviewCount } from "./admin-api";
const queueStyles = {
	selected: {
		button: "bg-accent/10",
		icon: "bg-accent/15 text-accent",
		arrow: "text-accent",
	},
	idle: {
		button: "hover:bg-black/[0.035] dark:hover:bg-white/5",
		icon: "bg-black/[0.04] text-black/55 dark:bg-white/5 dark:text-white/60",
		arrow: "text-black/25 group-hover:translate-x-0.5 dark:text-white/25",
	},
};
export function ReviewQueueEntry({
	selected,
	onPress,
}: {
	selected: boolean;
	onPress: () => void;
}) {
	const { data } = useSWR("admin-review-count", getAdminReviewCount);
	const count = data ?? 0;
	const style = queueStyles[selected ? "selected" : "idle"];
	return (
		<div className="px-2 pb-2 pt-3">
			<button
				type="button"
				aria-pressed={selected}
				onClick={onPress}
				className={`group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${style.button}`}
			>
				<span
					className={`grid size-8 shrink-0 place-items-center rounded-lg ${style.icon}`}
				>
					<HugeiconsIcon
						icon={InboxIcon}
						size={17}
						strokeWidth={1.7}
					/>
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-[13px] font-semibold">
						Review queue
					</span>
					<span className="mt-0.5 block text-[11px] text-black/45 dark:text-white/45">
						Awaiting review
					</span>
				</span>
				<span
					className={`grid h-5 min-w-5 place-items-center rounded-md px-1 text-[10px] font-semibold tabular-nums ${count ? "bg-accent/15 text-accent-700 dark:text-accent-300" : "bg-black/5 text-black/40 dark:text-white/40"}`}
				>
					{count}
				</span>
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					size={12}
					className={`shrink-0 transition-transform ${style.arrow}`}
				/>
			</button>
		</div>
	);
}
