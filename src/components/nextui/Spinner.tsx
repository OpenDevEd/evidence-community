"use client";

import { extendVariants, Spinner as NextUISpinner } from "@nextui-org/react";

export const Spinner = extendVariants(NextUISpinner, {
	variants: {
		color: {
			neutral: {
				circle1: "border-b-black/60 dark:border-b-white/60",
				circle2: "border-b-black/60 dark:border-b-white/60",
			},
		},
	},
	defaultVariants: { color: "neutral" },
});
