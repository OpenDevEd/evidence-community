"use client";

import { GlobalIcon, GlobalRefreshIcon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { useState } from "react";
import { toast } from "sonner";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { ADMIN_LIBRARY_PERMISSION, adminRoleHasPermission } from "@/lib/admin/permissions";

import { adminErrorMessage, clearAdminPublicCache } from "./admin-api";
import { useAdminSession } from "./AdminSessionProvider";
import { Tooltip } from "@/components/nextui/Tooltip";

const triggerClass = "inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.06]";
const noteClass = "text-xs leading-5 text-black/55 dark:text-white/55";

function PublicPagesPopover() {
	const { role } = useAdminSession();
	const [busy, setBusy] = useState(false);
	const canClear = adminRoleHasPermission(role, ADMIN_LIBRARY_PERMISSION);

	async function clear() {
		setBusy(true);
		try {
			await clearAdminPublicCache();
			toast.success("Public cache cleared");
		} catch (error) {
			toast.error(adminErrorMessage(error, "The public cache could not be cleared."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Popover disableAnimation placement="bottom-end">
			<Tooltip content="Public pages">
				<span className="inline-flex">
					<PopoverTrigger>
						<button aria-label="Public pages" className={`${triggerClass} text-black/45 hover:text-black/80 dark:text-white/45 dark:hover:text-white/80`} type="button">
							<HugeiconsIcon icon={GlobalIcon} aria-hidden size={15} />
						</button>
					</PopoverTrigger>
				</span>
			</Tooltip>
			<PopoverContent className="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card">
				<div className="w-full space-y-2 p-3">
					<p className={noteClass}>
						{canClear
							? "Published changes appear on their own. Clear the cache if a public page still looks wrong."
							: "Only an Owner can clear the public cache."}
					</p>
					<Button
						className="w-full"
						isDisabled={!canClear || busy}
						isLoading={busy}
						onPress={() => void clear()}
						size="xs"
						startContent={<HugeiconsIcon icon={GlobalRefreshIcon} aria-hidden size={14} />}
						variant="muted"
					>
						Clear public cache
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** The public cache. Editors and Owners only. */
export function AdminPublicPages() {
	return useAdminSession().canPublish ? <PublicPagesPopover /> : null;
}
