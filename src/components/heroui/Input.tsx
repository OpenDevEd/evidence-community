"use client";
import { extendVariants, Input as HeroUIInput } from "@heroui/react";

export const Input = extendVariants(HeroUIInput, {
	variants: {
		color: {
			secondary: {
				inputWrapper:
					"bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
				input: "placeholder:text-black/60 dark:placeholder:text-white/40",
			},
			card: {
				inputWrapper:
					"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%] data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-focus",
				input: "placeholder:text-black/60 dark:placeholder:text-white/40",
				label: "text-black/80 dark:text-white/80",
			},
		},
		variant: {
			default: {
				inputWrapper: "border",
			},
		},
		size: {
			md: {
				input: "text-base xl:text-small",
			},
		},
		custom: {
			default: {
				inputWrapper: "rounded-2xl",
			},
		},
		isInvalid: {
			true: {
				inputWrapper: "outline-medium outline-danger dark:outline-danger",
			},
		},
	},
	defaultVariants: {
		color: "secondary",
		custom: "default",
		variant: "default",
		size: "md",
		isInvalid: false,
	},
});
