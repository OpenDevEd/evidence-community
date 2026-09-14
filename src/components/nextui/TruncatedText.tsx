"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "./Tooltip";

/** Show the full value on hover only when its rendered text overflows. */
export function TruncatedText({
	text,
	className = "",
	focusable = false,
}: {
	text: string;
	className?: string;
	focusable?: boolean;
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
			placement="bottom-start"
			classNames={{ content: "max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal break-words" }}
		>
			<span ref={ref} className={`block min-w-0 truncate ${className}`} tabIndex={focusable && isTruncated ? 0 : undefined}>
				{text}
			</span>
		</Tooltip>
	);
}
