import type { ComponentPropsWithoutRef, CSSProperties } from "react";

import { twMerge } from "@/lib/tw-merge";

type MarkIconProps = Omit<ComponentPropsWithoutRef<"span">, "children"> & { size?: number };

/** A service's mark, drawn in the current text colour like the other icons. */
function markIcon(name: string, src: string) {
	const mask: CSSProperties = {
		WebkitMaskImage: `url(${src})`,
		maskImage: `url(${src})`,
		WebkitMaskRepeat: "no-repeat",
		maskRepeat: "no-repeat",
		WebkitMaskPosition: "center",
		maskPosition: "center",
		WebkitMaskSize: "contain",
		maskSize: "contain",
	};
	return function MarkIcon({ className, style, size = 14, ...props }: MarkIconProps) {
		return (
			<span
				aria-hidden
				data-icon={name}
				className={twMerge("inline-block shrink-0 bg-current", className)}
				style={{ width: size, height: size, ...mask, ...style }}
				{...props}
			/>
		);
	};
}

export const OpenAlexIcon = markIcon("openalex", "/icons/openalex.png");
export const OpenScholarIcon = markIcon("openscholar", "/icons/openscholar.svg");
