export const adminPanelTabState = (selected: boolean) =>
	selected
		? "rounded-t-lg bg-card_light text-black/85 dark:bg-card dark:text-white/85"
		: "rounded-t-lg bg-black/[0.04] text-black/45 hover:text-black/70 dark:bg-black/20 dark:text-white/45 dark:hover:text-white/70";
