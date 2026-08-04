"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import {
	CircleAlert,
	CircleCheck,
	Clock3,
	LoaderCircle,
	RefreshCw,
	SearchCheck,
	ServerOff,
} from "lucide-react";

import { Button } from "@/components/nextui/Button";
import { Progress } from "@/components/nextui/Progress";

import type { AdminSearchIndexView } from "./admin-search-index";

const statusAppearance = {
	checking: {
		className: "text-black/45 dark:text-white/50",
		icon: LoaderCircle,
		spin: true,
	},
	failed: {
		className: "text-danger",
		icon: CircleAlert,
		spin: false,
	},
	indexed: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: CircleCheck,
		spin: false,
	},
	indexing: {
		className: "text-accent-700 dark:text-accent-300",
		icon: LoaderCircle,
		spin: true,
	},
	offline: {
		className: "text-amber-700 dark:text-amber-300",
		icon: ServerOff,
		spin: false,
	},
	queued: {
		className: "text-accent-700 dark:text-accent-300",
		icon: Clock3,
		spin: false,
	},
	ready: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: SearchCheck,
		spin: false,
	},
	retrying: {
		className: "text-accent-700 dark:text-accent-300",
		icon: RefreshCw,
		spin: true,
	},
	unavailable: {
		className: "text-black/45 dark:text-white/50",
		icon: CircleAlert,
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
					className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.06] ${appearance.className}`}
					data-admin-search-index-status={view.kind}
					title={view.label}
					type="button"
				>
					<span className="grid size-3.5 shrink-0 place-items-center overflow-hidden">
						<Icon
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
							<Icon
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
					{view.canRetry ? (
						<Button
							className="w-full"
							color="accent"
							onPress={onRetry}
							size="xs"
							startContent={<RefreshCw aria-hidden size={14} />}
							variant="solid"
						>
							Retry indexing
						</Button>
					) : view.kind === "unavailable" ? (
						<Button
							className="w-full"
							onPress={onRefresh}
							size="xs"
							startContent={<RefreshCw aria-hidden size={14} />}
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
