"use client";

// A record's DOCiD (OpenDevEd/openscholar plans/identifier-services): the Africa PID Alliance's identifier, a Handle
// under 20.500.14351. Communities don't register DOCiDs; a record that came with one (an Openscholar report added to
// the community, or a source record that carries it) shows it here as one of its identifiers, kept as it came.
// MOCK (mock/identifier-services): a record has a DOCiD with `?docid=1` in the address, made up from its key.

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { Tooltip } from "@/components/nextui/Tooltip";

/** MOCK: the DOCiD a record has, or null. The build reads it from the record's identifiers. */
export function mockDocidOf(key: string): string | null {
	if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("docid")) return null;
	let hash = 0;
	for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
	return `20.500.14351/${hash.toString(16).slice(0, 6).padStart(6, "0")}`;
}

export function DocidPanel({ recordKey }: { recordKey: string }) {
	const handle = mockDocidOf(recordKey);
	if (!handle) return null;
	const url = `https://hdl.handle.net/${handle}`;
	return (
		<div className="mt-2 flex items-start gap-3 rounded-xl bg-black/[0.025] px-3 py-3 ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			<img src="/brands/docid.png" alt="DOCiD" className="mt-0.5 h-3.5 w-auto shrink-0" />
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
