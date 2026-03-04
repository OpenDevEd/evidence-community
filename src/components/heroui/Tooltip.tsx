"use client";

import { extendVariants, Tooltip as HeroUITooltip } from "@heroui/react";

export const Tooltip = extendVariants(HeroUITooltip, {
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