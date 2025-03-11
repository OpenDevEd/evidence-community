"use client";

import { extendVariants, Textarea as NextUITextarea } from "@nextui-org/react";

export const Textarea = extendVariants(NextUITextarea, {
	variants: {
		color: {
			secondary: {
				inputWrapper:
					"bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
				input: "placeholder:text-black/60 dark:placeholder:text-white/40",
			},
		},
		variant: {
			default: {
				inputWrapper: "border",
			},
		},
		size: {
			md: {
				input: "text-base lg:text-small"
			}
		},
		custom: {
			default: {
				inputWrapper: "rounded-2xl",
			},
		},
	},
	defaultVariants: {
		color: "secondary",
		custom: "default",
		variant: "default",
		size: "md"
	},
});
