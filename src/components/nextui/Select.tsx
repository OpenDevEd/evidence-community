"use client";
import { extendVariants, Select as NextUISelect } from "@nextui-org/react";
import type { ComponentProps } from "react";

import { filledFieldSurface } from "./field-styles";

const VariantSelect = extendVariants(NextUISelect, {
	variants: {
		color: {
			filled: {
				trigger: filledFieldSurface,
				value: "text-black/80 dark:text-white/60",
			},
			secondary: {
				trigger:
					"bg-white dark:bg-secondary text-black/80 dark:text-white/60 border-black/10 dark:border-white/10 data-[hover]:bg-black/[4%] dark:data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
				value: "text-black/80 dark:text-white/60 font-medium text-base",
				popoverContent:
					"bg-white dark:bg-secondary border-black/10 dark:border-white/10 text-black/80 dark:text-white/60",
			},
			tertiary: {
				trigger:
					"bg-tertiary dark:bg-tertiary/10 text-white dark:text-white/60 border-white/10 data-[hover]:bg-tertiary-600 dark:data-[hover]:bg-tertiary/20 data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
				value: "text-white dark:text-white/60 font-medium text-base",
				popoverContent:
					"select-popover-tertiary text-white dark:text-white/60 border-white/10",
				label: "text-white dark:text-white/60",
			},
		},
		variant: {
			default: {
				trigger: "border-small",
				value: "font-medium text-base text-center rtl:text-center",
				popoverContent: "border-small ",
				label: "text-center w-full",
			},
		},
		size: {
			sm: {
				base: "max-w-52",
			},
			md: {
				base: "max-w-72",
			},
		},
		placement: {
			center: {},
			left: {
				value: "text-left rtl:text-right",
				label: "text-left rtl:text-right",
			},
		},
		custom: {
			default: {
				trigger: "h-12 min-h-0 rounded-2xl",
				selectorIcon: "!size-6",
				popoverContent: "rounded-2xl",
			},
		},
	},
	defaultVariants: {
		variant: "default",
		custom: "default",
		size: "sm",
		color: "secondary",
		placement: "center",
	},
});

/**
 * A list stays open when the panel around it scrolls. React Aria stops the page scrolling while a list is open, and
 * Firefox answers that with a scroll event on every scrolling panel, which would shut a list in one at once.
 *
 * Each option is as tall as its label, which wraps when it is wider than the list (SelectItem). NextUI virtualizes a
 * list of more than 50 options with rows of a fixed 36px, where a wrapped label would run over the next one, so it
 * doesn't virtualize.
 */
export function Select(props: ComponentProps<typeof VariantSelect>) {
	return <VariantSelect isVirtualized={false} {...props} popoverProps={{ shouldCloseOnScroll: false, ...props.popoverProps }} />;
}
