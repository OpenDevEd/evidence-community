"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

/** Show the full value on hover only when its rendered text overflows. `tabIndex` makes the span focusable (only while truncated) so keyboard users can reveal it; -1 keeps it out of the tab order for composite widgets that manage focus. */
export function TruncatedText({
	text,
	className = "",
	tabIndex,
	isOpen,
	onOpenChange,
}: {
	text: string;
	className?: string;
	tabIndex?: 0 | -1;
	isOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [isTruncated, setIsTruncated] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => setIsTruncated(element.scrollWidth > element.clientWidth);
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		document.fonts.addEventListener("loadingdone", measure);
		measure();
		return () => {
			observer.disconnect();
			document.fonts.removeEventListener("loadingdone", measure);
		};
	}, [text]);

	return (
		<Tooltip
			content={text}
			isDisabled={!isTruncated}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			placement="bottom-start"
			classNames={{ content: "max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal break-words" }}
		>
			<span ref={ref} className={`block min-w-0 truncate ${className}`} data-truncated-text tabIndex={isTruncated ? tabIndex : undefined}>
				{text}
			</span>
		</Tooltip>
	);
}
