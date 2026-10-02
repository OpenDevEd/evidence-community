"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, Refresh01Icon, ReloadIcon } from "@hugeicons/core-free-icons";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "@/components/nextui/Button";

const SCROLL_EDGE_THRESHOLD = 64;

/**
 * Tracks whether a scroll container is away from its top/bottom edge so the
 * chat surfaces can fade content out under gradient masks.
 */
export function useScrollEdges() {
	const [edges, setEdges] = useState({ top: false, bottom: false });
	const cleanupRef = useRef<(() => void) | null>(null);

	const ref = useCallback((element: HTMLElement | null) => {
		cleanupRef.current?.();
		cleanupRef.current = null;
		if (!element) {
			setEdges({ top: false, bottom: false });
			return;
		}

		const update = () => {
			const top = element.scrollTop > SCROLL_EDGE_THRESHOLD;
			const bottom =
				element.scrollHeight -
					element.scrollTop -
					element.clientHeight >
				SCROLL_EDGE_THRESHOLD;
			setEdges((previous) =>
				previous.top === top && previous.bottom === bottom
					? previous
					: { top, bottom },
			);
		};

		update();
		element.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(element);
		const content = element.firstElementChild;
		if (content) observer.observe(content);
		const mutations = new MutationObserver(update);
		mutations.observe(element, { childList: true, subtree: true });
		cleanupRef.current = () => {
			element.removeEventListener("scroll", update);
			observer.disconnect();
			mutations.disconnect();
		};
	}, []);

	useEffect(() => () => cleanupRef.current?.(), []);

	return { edges, ref };
}

/** Error alert shared between the chat modal and the inline library chat. */
export function ChatErrorCard({
	message,
	isContextTooLarge,
	onReset,
	onRetry,
	className,
}: {
	message: string;
	isContextTooLarge: boolean;
	onReset: () => void;
	onRetry: () => void;
	className?: string;
}) {
	const tUI = useTranslations("ui");

	return (
		<div
			role="alert"
			className={twMerge(
				"flex w-full flex-col gap-3 rounded-2xl border border-danger/15 bg-white p-4 shadow-card-soft dark:border-danger/25 dark:bg-secondary-400 dark:shadow-none",
				className,
			)}
		>
			<div className="flex items-start gap-3">
				<span className="mt-px grid size-8 shrink-0 place-items-center rounded-full bg-danger/10 text-danger dark:bg-danger/15">
					<HugeiconsIcon icon={AlertCircleIcon} className="size-icon-md" />
				</span>
				<div className="min-w-0 flex-1 pt-1">
					<p className="text-sm font-semibold leading-snug text-black/80 dark:text-white/85">
						{tUI("errorTitle")}
					</p>
					<p className="mt-1 break-words text-sm leading-relaxed text-black/60 dark:text-white/60">
						{message}
					</p>
				</div>
			</div>
			<div className="flex justify-end">
				<Button
					size="sm"
					variant="transparent"
					startContent={
						isContextTooLarge ? (
							<HugeiconsIcon icon={ReloadIcon} className="size-3.5" />
						) : (
							<HugeiconsIcon icon={Refresh01Icon} className="size-3.5" />
						)
					}
					className="h-8 shrink-0 gap-1.5 rounded-xl bg-danger/10 px-3 text-xs font-semibold text-danger hover:bg-danger/15 dark:bg-danger/15 dark:hover:bg-danger/20"
					aria-label={
						isContextTooLarge ? tUI("resetAriaLabel") : tUI("retry")
					}
					onPress={isContextTooLarge ? onReset : onRetry}
				>
					{isContextTooLarge ? tUI("resetChat") : tUI("retry")}
				</Button>
			</div>
		</div>
	);
}

/** Keyboard-shortcut chip for tooltips and hint rows. */
function Kbd({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<kbd
			className={twMerge(
				"inline-flex h-icon-md min-w-icon-md items-center justify-center rounded-md border border-black/10 bg-black/[0.04] px-1 font-sans text-icon-xs font-medium leading-none text-black/60 dark:border-white/15 dark:bg-white/[0.08] dark:text-white/70",
				className,
			)}
		>
			{children}
		</kbd>
	);
}

/** "Label  ⌘↵" tooltip body: text plus one or more shortcut chips. */
export function ShortcutHint({
	label,
	keys,
}: {
	label: ReactNode;
	keys: ReactNode[];
}) {
	return (
		<span className="flex items-center gap-1.5 text-xs">
			{label}
			<span className="flex items-center gap-0.5">
				{keys.map((key, index) => (
					<Kbd key={index}>{key}</Kbd>
				))}
			</span>
		</span>
	);
}
