"use client";

// A record's DOCiD in the record editor's Identifiers (OpenDevEd/evidence-community#934): the one it came with, kept
// as it came. Communities don't register DOCiDs, so there is nothing to change here; its Extra holds it.

import Image from "next/image";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { Tooltip } from "@/components/nextui/Tooltip";
import { docidUrl } from "@/lib/docid";

export function DocidFact({ handle }: { handle: string }) {
	const url = docidUrl(handle);
	return (
		<div className="mt-2 flex items-start gap-3 rounded-xl bg-black/[0.025] px-3 py-3 ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			<Image unoptimized src="/brands/docid.png" alt="DOCiD" width={51} height={14} className="mt-0.5 h-3.5 w-auto shrink-0" />
			<div className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
					<a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 truncate font-mono text-[11px] text-black/80 hover:underline dark:text-white/85">
						{handle}
					</a>
					<Tooltip content="Copy the DOCiD">
						<button type="button" aria-label="Copy the DOCiD" className="grid size-5 shrink-0 place-items-center rounded text-black/45 hover:bg-black/5 dark:text-white/45" onClick={() => void navigator.clipboard?.writeText(url)}>
							<HugeiconsIcon icon={Copy01Icon} aria-hidden size={12} />
						</button>
					</Tooltip>
				</span>
				<p className="mt-1 text-[11px] leading-relaxed text-black/45 dark:text-white/45">Came with the record. The Africa PID Alliance&apos;s identifier, kept as it came.</p>
			</div>
		</div>
	);
}
