"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CloudIcon, HardDriveIcon } from "@hugeicons/core-free-icons";
import { siZotero } from "simple-icons";

import BrandIcon from "@/components/icons/BrandIcon";
import { OpenAlexIcon, OpenScholarIcon } from "@/components/icons/SourceMarkIcons";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

/**
 * One icon per kind of source, used wherever sources are listed: the
 * library's own records, Zotero groups, OpenAlex searches, OpenScholar collections and any other
 * provider.
 */
export function SourceProviderIcon({
	provider,
	size = 14,
	...props
}: { provider: string; size?: number } & Omit<Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">, "size">) {
	if (provider === NATIVE_SOURCE_CONNECTION_KEY) {
		return <HugeiconsIcon icon={HardDriveIcon} aria-hidden size={size} {...props} />;
	}
	if (provider === "zotero") {
		return (
			<BrandIcon
				icon={siZotero}
				aria-hidden
				className={props.className}
				width={size}
				height={size}
				style={props.style}
			/>
		);
	}
	if (provider === "openalex") {
		return <OpenAlexIcon size={size} className={props.className} style={props.style} />;
	}
	if (provider === "openscholar") {
		return <OpenScholarIcon size={size} className={props.className} style={props.style} />;
	}
	return <HugeiconsIcon icon={CloudIcon} aria-hidden size={size} {...props} />;
}
