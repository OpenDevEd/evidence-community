"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, CheckmarkCircle01Icon, Clock03Icon, Loading03Icon, Refresh01Icon, SearchCheckIcon, ServerOffIcon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";

import { useAdminSession } from "./AdminSessionProvider";
import { Button } from "@/components/nextui/Button";
import { Progress } from "@/components/nextui/Progress";

import type { AdminSearchIndexView } from "./admin-search-index";

const statusAppearance = {
	checking: {
		className: "text-black/45 dark:text-white/50",
		icon: Loading03Icon,
		spin: true,
	},
	failed: {
		className: "text-danger",
		icon: AlertCircleIcon,
		spin: false,
	},
	indexed: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: CheckmarkCircle01Icon,
		spin: false,
	},
	indexing: {
		className: "text-accent-300 dark:text-accent-700",
		icon: Loading03Icon,
		spin: true,
	},
	offline: {
		className: "text-amber-700 dark:text-amber-300",
		icon: ServerOffIcon,
		spin: false,
	},
	queued: {
		className: "text-accent-300 dark:text-accent-700",
		icon: Clock03Icon,
		spin: false,
	},
	ready: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: SearchCheckIcon,
		spin: false,
	},
	retrying: {
		className: "text-accent-300 dark:text-accent-700",
		icon: Refresh01Icon,
		spin: true,
	},
	unavailable: {
		className: "text-black/45 dark:text-white/50",
		icon: AlertCircleIcon,
		spin: false,
	},
} as const;

export function AdminSearchIndexStatus({
	error,
	onRefresh,
	onRetry,
	view,
}: {
	error: string | null;
	onRefresh: () => void;
	onRetry: () => void;
	view: AdminSearchIndexView;
}) {
	const { canPublish } = useAdminSession();
	const appearance = statusAppearance[view.kind];
	const Icon = appearance.icon;
	return (
		<>
			<span aria-live="polite" className="sr-only" role="status">
				Search indexing: {view.label}
			</span>
			<Popover disableAnimation placement="bottom-end">
			<PopoverTrigger>
				<button
					aria-label={`Search indexing: ${view.label}`}
					className={`inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.06] ${appearance.className}`}
					data-admin-search-index-status={view.kind}
					title={view.label}
					type="button"
				>
					<span className="grid size-3.5 shrink-0 place-items-center overflow-hidden">
						<HugeiconsIcon
							icon={Icon}
							aria-hidden
							className={appearance.spin ? "animate-spin" : undefined}
							size={14}
							strokeWidth={2}
						/>
					</span>
					<span className="hidden whitespace-nowrap 2xl:inline">
						{view.label}
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card"
				data-admin-search-index-popover
			>
				<div
					className="w-full space-y-3 p-3"
					data-admin-search-index-content
				>
					<div className="flex items-start gap-2.5">
						<span
							className={`mt-0.5 grid size-[15px] shrink-0 place-items-center overflow-hidden ${appearance.className}`}
						>
							<HugeiconsIcon
								icon={Icon}
								aria-hidden
								className={appearance.spin ? "animate-spin" : undefined}
								size={15}
								strokeWidth={2}
							/>
						</span>
						<div className="min-w-0 flex-1">
							<div className="text-sm font-semibold text-black/80 dark:text-white/85">
								{view.label}
							</div>
							<p className="mt-0.5 text-xs leading-5 text-black/55 dark:text-white/55">
								{view.description}
							</p>
						</div>
					</div>
					{view.progress !== null ? (
						<Progress
							aria-label="Search indexing progress"
							classNames={{
								indicator: "duration-150",
								track: "h-1",
							}}
							value={view.progress}
						/>
					) : null}
					{error ? (
						<p className="text-xs leading-5 text-danger" role="alert">
							{error}
						</p>
					) : null}
					{view.canRetry && canPublish ? (
						<Button
							className="w-full"
							color="accent"
							onPress={onRetry}
							size="xs"
							startContent={<HugeiconsIcon icon={Refresh01Icon} aria-hidden size={14} />}
							variant="solid"
						>
							Retry indexing
						</Button>
					) : view.kind === "unavailable" ? (
						<Button
							className="w-full"
							onPress={onRefresh}
							size="xs"
							startContent={<HugeiconsIcon icon={Refresh01Icon} aria-hidden size={14} />}
							variant="solid"
						>
							Check again
						</Button>
					) : null}
				</div>
			</PopoverContent>
			</Popover>
		</>
	);
}
