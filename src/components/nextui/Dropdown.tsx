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
			// React Aria gives the popover the height left below its button; the layers inside take it, so a menu taller than
			// that (large text on a phone) scrolls instead of running off the screen, where the page can't be scrolled to it.
			default: {
				base: "max-h-[inherit]",
				// From its top: centred, a menu taller than the screen would push its first rows out of reach.
				content: "rounded-2xl max-h-[inherit] max-w-[calc(100vw-1.5rem)] overflow-y-auto justify-start",
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
	return <StyledDropdown data-react-aria-top-layer="true" motionProps={{ className: "max-h-[inherit]" }} {...props} />;
}
