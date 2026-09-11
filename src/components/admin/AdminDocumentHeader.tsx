"use client";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { ArrowDown01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Tooltip } from "@/components/nextui/Tooltip";
import { toast } from "sonner";
import { humanizeAdminField } from "./admin-schema";
import type { AdminItemDetail } from "@/lib/admin/types";

export function AdminDocumentHeader({
	detail,
	cover,
	status,
	menu,
	menuOpen,
	onMenuOpenChange,
	actions,
	parent,
	saveIndicator,
}: {
	detail: AdminItemDetail;
	cover: ReactNode;
	status: ReactNode;
	menu: ReactNode;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
	actions: ReactNode;
	parent: ReactNode;
	saveIndicator: ReactNode;
}) {
	return (
		<div
			className="shrink-0 border-b border-black/[0.06] dark:border-white/[0.06]"
			data-admin-document-header
		>
			{parent}
			<div className="flex items-start gap-4 p-4 pb-3">
				{cover}
				<div className="min-w-0 flex-1">
					<Tooltip
						content={detail.title}
						placement="bottom-start"
						classNames={{
							content: "max-w-[min(24rem,calc(100vw-2rem))]",
						}}
					>
						<h2
							tabIndex={0}
							className="line-clamp-3 text-inspector-title font-semibold leading-6 tracking-tight text-black/90 outline-none dark:text-white/95"
						>
							{detail.title}
						</h2>
					</Tooltip>
					<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="text-[11px] text-black/45 dark:text-white/45">
							{humanizeAdminField(detail.itemType)}
						</span>
						<Tooltip content="Copy item key">
							<Button
								variant="transparent"
								size="xs"
								className="h-6 min-w-0 gap-1.5 rounded-md px-1 text-[10px] text-black/45 dark:text-white/45"
								onPress={() => {
									void navigator.clipboard
										.writeText(detail.key)
										.then(() =>
											toast.success("Item key copied"),
										)
										.catch(() =>
											toast.error(
												"Could not copy item key",
											),
										);
								}}
								endContent={
									<HugeiconsIcon
										icon={Copy01Icon}
										size={11}
									/>
								}
							>
								<span className="font-mono">{detail.key}</span>
							</Button>
						</Tooltip>
						{saveIndicator}
					</div>
					<Popover
						placement="bottom-start"
						isOpen={menuOpen}
						onOpenChange={onMenuOpenChange}
					>
						<PopoverTrigger>
							<Button
								size="xs"
								variant="transparent"
								className="-ml-1 mt-1 h-8 min-w-0 gap-1.5 rounded-lg px-1 text-left font-medium text-black/70 hover:bg-black/[0.04] dark:text-white/75 dark:hover:bg-white/[0.04]"
								aria-label="Review status and history"
								endContent={
									<HugeiconsIcon
										icon={ArrowDown01Icon}
										size={11}
										className="text-black/45 dark:text-white/45"
									/>
								}
							>
								{status}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="max-h-[min(32rem,70dvh)] w-72 items-stretch overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-4 shadow-xl dark:border-white/[0.08] dark:bg-[#202020]">
							{menu}
						</PopoverContent>
					</Popover>
				</div>
			</div>
			<div className="flex min-h-[60px] items-center gap-2 bg-black/[0.02] px-4 py-3 dark:bg-white/[0.02]">
				{actions}
			</div>
		</div>
	);
}
