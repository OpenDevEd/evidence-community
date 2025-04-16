import { extendVariants } from "@heroui/react";
import { Dropdown as NextUIDropdown } from "@heroui/react";

export const Dropdown = extendVariants(NextUIDropdown, {
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
