"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

/** Show the full value on hover only when its rendered text overflows. `focusable` lets keyboard users reveal it (only while truncated); `managed` keeps it out of the document tab order for composite widgets that move focus themselves. */
export function TruncatedText({
	text,
	className = "",
	lines = 1,
	focusable = false,
	managed = false,
	isOpen,
	onOpenChange,
}: {
	text: string;
	className?: string;
	/** Clip after this many lines instead of one. */
	lines?: 1 | 2;
	focusable?: boolean;
	managed?: boolean;
	isOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [isTruncated, setIsTruncated] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => setIsTruncated(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
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
			<span ref={ref} className={`min-w-0 ${lines === 2 ? "line-clamp-2" : "block truncate"} ${className}`} data-truncated-text tabIndex={focusable && isTruncated ? (managed ? -1 : 0) : undefined}>
				{text}
			</span>
		</Tooltip>
	);
}
