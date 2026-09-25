"use client";

import { ViewIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";

/** Tells an admin in live view that this page skips the public cache. */
export default function LiveViewNotice() {
	const router = useRouter();
	const [leaving, setLeaving] = useState(false);

	async function leave() {
		setLeaving(true);
		try {
			await fetch("/api/admin/live-view", { method: "DELETE" });
			router.refresh();
		} finally {
			setLeaving(false);
		}
	}

	return (
		<div
			className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-black/[0.08] bg-white py-2 pe-2 ps-3 text-sm shadow-lg dark:border-white/[0.09] dark:bg-card"
			role="status"
		>
			<HugeiconsIcon icon={ViewIcon} aria-hidden className="shrink-0 text-accent" size={16} />
			<span className="text-black/75 dark:text-white/75">
				Live view: this browser skips the public cache.
			</span>
			<Button isLoading={leaving} onPress={() => void leave()} size="xs" variant="muted">
				Leave live view
			</Button>
		</div>
	);
}
