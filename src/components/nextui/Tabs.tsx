"use client";
import { extendVariants, Tabs as NextUITabs, Tab as NextUITab } from "@nextui-org/react";

export const Tabs = extendVariants(NextUITabs, {
	variants: {
		color: {
			secondary: {
				base: "bg-transparent w-full",
				tabList: "bg-white dark:bg-secondary border border-black/10 dark:border-white/10 rounded-2xl p-0.5 md:p-1 w-full md:w-auto",
				tab: "text-black/60 dark:text-white/60 data-[selected=true]:!text-white [&_*]:data-[selected=true]:!text-white data-[selected=true]:!bg-transparent flex-1 md:flex-initial",
				cursor: "!bg-accent dark:!bg-accent-500 rounded-xl",
			},
			card: {
				base: "bg-transparent w-full",
				tabList: "bg-white dark:bg-card border border-black/10 dark:border-white/10 rounded-2xl p-0.5 md:p-1 w-full md:w-auto",
				tab: "text-black/60 dark:text-white/60 data-[selected=true]:!text-white [&_*]:data-[selected=true]:!text-white data-[selected=true]:!bg-transparent flex-1 md:flex-initial",
				cursor: "!bg-accent dark:!bg-accent-500 rounded-xl",
			},
			accent: {
				base: "bg-transparent w-full",
				tabList: "bg-white dark:bg-secondary border border-black/10 dark:border-white/10 rounded-2xl p-0.5 md:p-1 w-full md:w-auto",
				tab: "text-black/60 dark:text-white/60 data-[selected=true]:!text-white [&_*]:data-[selected=true]:!text-white data-[selected=true]:!bg-transparent flex-1 md:flex-initial",
				cursor: "!bg-accent dark:!bg-accent-500 rounded-xl",
			},
		},
		variant: {
			default: {
				tabList: "rounded-2xl",
				tab: "rounded-xl",
			},
		},
		size: {
			md: {
				tab: "text-xs md:text-sm px-2 md:px-4 py-1.5 md:py-2 whitespace-nowrap",
			},
			lg: {
				tab: "text-sm md:text-base px-3 md:px-6 py-2 md:py-3 whitespace-nowrap",
			},
		},
	},
	defaultVariants: {
		color: "secondary",
		variant: "default",
		size: "md",
	},
});

export const Tab = NextUITab;

