import type { ComponentProps } from "react";
import { extendVariants } from "@nextui-org/react";
import { Dropdown as NextUIDropdown } from "@nextui-org/react";

const StyledDropdown = extendVariants(NextUIDropdown, {
	variants: {
		color: {
			secondary: {
				content:
					"bg-white dark:bg-secondary border-black/10 dark:border-white/10 text-black/80 dark:text-white/60",
			},
			accent: {
				content:
					"bg-accent dark:bg-accent text-white dark:text-white border-transparent dark:border-transparent",
			},
		},
		variant: {
			default: {
				content: "border-small",
			},
		},
		custom: {
			default: {
				content: "rounded-2xl",
			},
		},
	},
	defaultVariants: {
		variant: "default",
		custom: "default",
		color: "secondary",
	},
});

/**
 * An open dialog hides from screen readers everything added to the page outside it, and NextUI never takes that back
 * from a menu opened inside the dialog, so its choices were unreadable. A top layer, as React Aria marks its own, is
 * left visible.
 */
export function Dropdown(props: ComponentProps<typeof StyledDropdown>) {
	return <StyledDropdown data-react-aria-top-layer="true" {...props} />;
}
