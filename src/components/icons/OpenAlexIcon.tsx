import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { twMerge } from "@/lib/tw-merge";

/** OpenAlex's mark, drawn in the current text colour like the other icons. */
const MASK_STYLE: CSSProperties = {
	WebkitMaskImage: "url(/icons/openalex.png)",
	maskImage: "url(/icons/openalex.png)",
	WebkitMaskRepeat: "no-repeat",
	maskRepeat: "no-repeat",
	WebkitMaskPosition: "center",
	maskPosition: "center",
	WebkitMaskSize: "contain",
	maskSize: "contain",
};

export function OpenAlexIcon({
	className,
	style,
	size = 14,
	...props
}: Omit<ComponentPropsWithoutRef<"span">, "children"> & { size?: number }) {
	return (
		<span
			aria-hidden
			data-icon="openalex"
			className={twMerge("inline-block shrink-0 bg-current", className)}
			style={{ width: size, height: size, ...MASK_STYLE, ...style }}
			{...props}
		/>
	);
}
