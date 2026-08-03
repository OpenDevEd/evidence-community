"use client";

import { useMemo } from "react";
import { twMerge } from "tailwind-merge";
import { renderZoteroMarkup } from "@/lib/renderZoteroMarkup";

export default function ZoteroRichText({
	markup,
	className,
}: {
	markup: string;
	className?: string;
}) {
	const content = useMemo(() => renderZoteroMarkup(markup), [markup]);

	return (
		<div className={twMerge("zotero-rich-text", className)}>{content}</div>
	);
}
