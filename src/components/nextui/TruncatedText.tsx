"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

/** Show the full value on hover only when its rendered text overflows. `focusable` lets keyboard users reveal it (only while truncated); `managed` keeps it out of the document tab order for composite widgets that move focus themselves. */
export function TruncatedText({
	text,
	className = "",
	focusable = false,
	managed = false,
	isOpen,
	onOpenChange,
}: {
	text: string;
	className?: string;
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
			<span ref={ref} className={`block min-w-0 truncate ${className}`} data-truncated-text tabIndex={focusable && isTruncated ? (managed ? -1 : 0) : undefined}>
				{text}
			</span>
		</Tooltip>
	);
}
