"use client";

import { useTranslations } from "next-intl";
import {
	RiErrorWarningLine,
	RiRefreshLine,
	RiResetLeftFill,
} from "react-icons/ri";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";

/** The alert the reader sees when a chat request fails. */
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
					<RiErrorWarningLine className="size-icon-md" />
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
							<RiResetLeftFill className="size-3.5" />
						) : (
							<RiRefreshLine className="size-3.5" />
						)
					}
					className="h-8 shrink-0 gap-1.5 rounded-xl bg-danger/10 px-3 text-xs font-semibold text-danger hover:bg-danger/15 dark:bg-danger/15 dark:hover:bg-danger/20"
					aria-label={
						isContextTooLarge
							? tUI("resetAriaLabel")
							: tUI("tryAgainLater")
					}
					onClick={isContextTooLarge ? onReset : onRetry}
				>
					{isContextTooLarge ? tUI("resetChat") : tUI("retry")}
				</Button>
			</div>
		</div>
	);
}
