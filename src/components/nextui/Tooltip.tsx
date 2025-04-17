"use client";

import { extendVariants, Tooltip as NextUITooltip } from "@heroui/react";

export const Tooltip = extendVariants(NextUITooltip, {
	variants: {
		color: {
			card: {
				content: "bg-white dark:bg-card border border-white/10"
            }
		},
	},
    defaultVariants: {
        color: "card"
    }
})