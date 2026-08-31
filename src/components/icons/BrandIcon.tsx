import type { SVGProps } from "react";
import type { SimpleIcon } from "simple-icons";

type BrandIconProps = SVGProps<SVGSVGElement> & {
	icon: SimpleIcon;
};

/** Renders an official Simple Icons brand mark with the same current-color contract as app icons. */
export default function BrandIcon({ icon, ...props }: BrandIconProps) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" {...props}>
			<path d={icon.path} />
		</svg>
	);
}
