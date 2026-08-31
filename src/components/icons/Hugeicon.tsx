import {
	HugeiconsIcon as BaseHugeiconsIcon,
	type HugeiconsIconProps,
} from "@hugeicons/react";

export type { HugeiconsIconProps, IconSvgElement } from "@hugeicons/react";

/** Keeps unsized Hugeicons aligned with surrounding text, matching the app's old icon contract. */
export function HugeiconsIcon({ size = "1em", ...props }: HugeiconsIconProps) {
	return <BaseHugeiconsIcon size={size} {...props} />;
}
