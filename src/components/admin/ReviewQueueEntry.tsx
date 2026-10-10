"use client";
import { createContext, useContext } from "react";
import useSWR from "swr";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { InboxIcon, ArrowRight01Icon, News01Icon } from "@hugeicons/core-free-icons";
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
/** A card at the head of the admin navigation that opens a queue: its icon, name, what waits in it, and how many. */
function QueueCard({
	icon,
	title,
	detail,
	count,
	selected,
	onPress,
}: {
	icon: typeof InboxIcon;
	title: string;
	detail: string;
	count: number;
	selected: boolean;
	onPress: () => void;
}) {
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
						icon={icon}
						size={17}
						strokeWidth={1.7}
					/>
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-[13px] font-semibold">
						{title}
					</span>
					<span className="mt-0.5 block text-[11px] text-black/45 dark:text-white/45">
						{detail}
					</span>
				</span>
				<span
					className={`grid h-5 min-w-5 place-items-center rounded-md px-1 text-[10px] font-semibold tabular-nums ${count ? "bg-accent/15 text-accent-300 dark:text-accent-700" : "bg-black/5 text-black/40 dark:text-white/40"}`}
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

/** The digests view as the workbench has it: whether it is open, how many digests wait for an Editor or Owner, and what opens it. */
export const DigestsQueue = createContext<{ selected: boolean; waiting: number; onPress: () => void } | null>(null);

/** What waits for an Editor or Owner, at the head of the navigation: records sent for review, and digests. Opening one closes the other. */
export function ReviewQueueEntry({
	selected,
	onPress,
}: {
	selected: boolean;
	onPress: () => void;
}) {
	const { data = 0 } = useSWR("admin-review-count", getAdminReviewCount);
	const digests = useContext(DigestsQueue);
	if (!digests) return <QueueCard icon={InboxIcon} title="Review queue" detail="Awaiting review" count={data} selected={selected} onPress={onPress} />;
	return <>
		<QueueCard icon={InboxIcon} title="Review queue" detail="Awaiting review" count={data} selected={selected && !digests.selected} onPress={onPress} />
		<div className="-mt-3"><QueueCard icon={News01Icon} title="Digests" detail="Awaiting review" count={digests.waiting} selected={digests.selected} onPress={digests.onPress} /></div>
	</>;
}
