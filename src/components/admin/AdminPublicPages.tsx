"use client";

import { GlobalIcon, GlobalRefreshIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { useState, type ComponentProps } from "react";
import { toast } from "sonner";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Switch } from "@/components/nextui/Switch";
import { ADMIN_LIBRARY_PERMISSION, adminRoleHasPermission } from "@/lib/admin/permissions";

import { adminErrorMessage, clearAdminPublicCache, setAdminLiveView } from "./admin-api";
import { useAdminSession } from "./AdminSessionProvider";

const triggerClass = "inline-flex h-10 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-medium transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.06]";
const noteClass = "text-xs leading-5 text-black/55 dark:text-white/55";

// Popover passes its trigger props and ref through here.
function PublicPagesTrigger({ liveView, ...props }: ComponentProps<"button"> & { liveView: boolean }) {
	if (!liveView) {
		return (
			<button {...props} aria-label="Public pages" className={`${triggerClass} text-black/45 hover:text-black/80 dark:text-white/45 dark:hover:text-white/80`} title="Public pages" type="button">
				<HugeiconsIcon icon={GlobalIcon} aria-hidden size={15} />
			</button>
		);
	}
	return (
		<button {...props} aria-label="Public pages: live view on" className={`${triggerClass} text-accent`} title="Public pages" type="button">
			<HugeiconsIcon icon={ViewIcon} aria-hidden size={15} />
			<span className="whitespace-nowrap">Live view</span>
		</button>
	);
}

function PublicPagesPopover({ initialLiveView }: { initialLiveView: boolean }) {
	const { role } = useAdminSession();
	const [liveView, setLiveView] = useState(initialLiveView);
	const [busy, setBusy] = useState<"live" | "clear" | null>(null);
	const canClear = adminRoleHasPermission(role, ADMIN_LIBRARY_PERMISSION);

	async function run(action: "live" | "clear", task: () => Promise<void>) {
		setBusy(action);
		try { await task(); }
		catch (error) { toast.error(adminErrorMessage(error, "The public pages could not be updated.")); }
		finally { setBusy(null); }
	}

	return (
		<Popover disableAnimation placement="bottom-end">
			<PopoverTrigger>
				<PublicPagesTrigger liveView={liveView} />
			</PopoverTrigger>
			<PopoverContent className="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card">
				<div className="w-full space-y-4 p-3">
					<div className="space-y-1">
						<Switch
							classNames={{ base: "w-full max-w-none justify-between", label: "text-sm font-semibold text-black/80 dark:text-white/85" }}
							color="accent"
							isDisabled={busy !== null}
							isSelected={liveView}
							onValueChange={(on) => void run("live", async () => {
								await setAdminLiveView(on);
								setLiveView(on);
							})}
						>
							Live view
						</Switch>
						<p className={noteClass}>
							This browser shows current data on public pages instead of the cached copy. Visitors still get the cache.
						</p>
					</div>
					<div className="space-y-2">
						<p className={noteClass}>
							{canClear
								? "Published changes appear on their own. Clear the cache if a public page still looks wrong."
								: "Only an Owner can clear the public cache."}
						</p>
						<Button
							className="w-full"
							isDisabled={!canClear || busy !== null}
							isLoading={busy === "clear"}
							onPress={() => void run("clear", async () => {
								await clearAdminPublicCache();
								toast.success("Public cache cleared");
							})}
							size="xs"
							startContent={<HugeiconsIcon icon={GlobalRefreshIcon} aria-hidden size={14} />}
							variant="muted"
						>
							Clear public cache
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** Live view and the public cache. Editors and Owners only. */
export function AdminPublicPages({ initialLiveView }: { initialLiveView: boolean }) {
	return useAdminSession().canPublish ? <PublicPagesPopover initialLiveView={initialLiveView} /> : null;
}
