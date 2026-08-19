"use client";

import { Cloud, HardDrive, type LucideProps } from "lucide-react";
import { SiZotero } from "react-icons/si";

import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

/**
 * One icon per kind of source, used wherever sources are listed: the
 * library's own records, Zotero groups, and any other provider.
 */
export function SourceProviderIcon({
	provider,
	size = 14,
	...props
}: { provider: string; size?: number } & Omit<LucideProps, "size">) {
	if (provider === NATIVE_SOURCE_CONNECTION_KEY) {
		return <HardDrive aria-hidden size={size} {...props} />;
	}
	if (provider === "zotero") {
		return (
			<SiZotero
				aria-hidden
				className={props.className}
				size={size}
				style={props.style}
			/>
		);
	}
	return <Cloud aria-hidden size={size} {...props} />;
}
