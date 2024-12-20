export type LinkObject = {
	label: string;
	href: string;
	icon?: React.ElementType;
	dropdown?: LinkObject[];
	navExclude?: boolean;
	footerExclude?: boolean;
};