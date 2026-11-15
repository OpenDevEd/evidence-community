"use client";

import type { ReactNode } from "react";
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";
import {
	AdminSourcesWritebackStatus,
	type AdminWritebackSourceSummary,
} from "./AdminSourceWritebackStatus";

export function AdminRecordStatusMenu({
	header,
	children,
	footer,
	manageAction,
	restriction,
	sources,
	itemKey,
	revision,
	onResolved,
	canLoadRemote,
}: {
	/** Sits above the scrolling part, so its band reaches both edges past the scrollbar's space. */
	header: ReactNode;
	children: ReactNode;
	footer: ReactNode;
	manageAction?: ReactNode;
	restriction?: string;
	sources: readonly AdminWritebackSourceSummary[];
	itemKey: string;
	revision: number | null;
	onResolved: (result: AdminSearchIndexMutationResult) => void;
	canLoadRemote: boolean;
}) {
	return (
		<div className="flex min-h-0 w-full max-h-[inherit] flex-col">
			{header}
			<div className="grid min-h-0 grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
				<div>{children}</div>
				<div className="border-t border-black/[0.07] pt-3 dark:border-white/[0.08]">
					<AdminSourcesWritebackStatus
						restriction={restriction}
						sources={sources}
						itemKey={itemKey}
						revision={revision}
						onResolved={onResolved}
						manageAction={manageAction}
						canLoadRemote={canLoadRemote}
					/>
				</div>
			</div>
			<div className="has-[>div:empty]:hidden flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-black/[0.07] bg-black/[0.02] p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
				{footer}
			</div>
		</div>
	);
}
