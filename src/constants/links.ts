import AboutUs from "@/components/icons/AboutUs";
import EvidenceLibrary from "@/components/icons/EvidenceLibrary";
import Programs from "@/components/icons/Programs";
import Blog from "@/components/icons/Blog";
import Team from "@/components/icons/Team";
import ContactUs from "@/components/icons/ContactUs";
import {
	RiBookOpenFill,
	RiFacebookCircleFill,
	RiLinkedinBoxFill,
	RiTeamFill,
	RiToolsFill,
	RiTwitterXFill,
} from "react-icons/ri";
import { BsChatRightDotsFill } from "react-icons/bs";
import { GiBookshelf } from "react-icons/gi";
import { FaTools } from "react-icons/fa";
import { style } from "@/../tailwind.config";
export type LinkObject = {
	label: string;
	href: string;
	icon?: React.ElementType;
	dropdown?: LinkObject[];
	navExclude?: boolean;
	footerExclude?: boolean;
};

export const links: Record<string, LinkObject[]> = {
	opendeved: [
		{
			label: "Home",
			href: "/",
			navExclude: true,
		},
		{
			label: "About Us",
			href: "/about-us",
			icon: AboutUs,
		},
		{
			label: "Evidence Library",
			href: "/lib",
			icon: EvidenceLibrary,
		},
		{
			label: "Programs",
			href: "/programs",
			icon: Programs,
		},
		{
			label: "Blog",
			href: "/blog",
			icon: Blog,
		},
		{
			label: "Team",
			href: "/team",
			icon: Team,
		},
		{
			label: "Contact Us",
			href: "/contact-us",
			icon: ContactUs,
			footerExclude: true,
		},
	],
	edtechhub: [
		{
			label: "Home",
			href: "/",
			navExclude: true,
		},
		{
			label: "About Us",
			href: "/about-us",
			icon: RiTeamFill,
		},
		{
			label: "Tools",
			href: "/tools",
			icon: RiToolsFill,
		},
		{
			label: "Evidence",
			href: "/lib",
			icon: RiBookOpenFill,
			dropdown: [
				{
					label: "About Evidence in EdTech",
					href: "/blog/about-evidence-in-edtech",
				},
				{
					label: "Evidence Library",
					href: "/lib",
				},
				{
					label: "Country Engagement",
					href: "/country-engagement",
				},
				{
					label: "Topic Areas",
					href: "/topic-areas",
				},
				{
					label: "Research Portfolio",
					href: "/research-portfolio",
				},
				{
					label: "Sandboxes",
					href: "/sandboxes",
				},
				{
					label: "Helpdesk",
					href: "/helpdesk",
				},
			],
		},
		{
			label: "Blog",
			href: "/blog",
			icon: GiBookshelf,
		},
		{
			label: "Connect with us",
			href: "/contact-us",
			icon: BsChatRightDotsFill,
			footerExclude: true,
		},
	],
};

export const socialLinks = [
	{
		label: "LinkedIn",
		href: "https://www.linkedin.com/profile.php?id=100093141111111",
		icon: RiLinkedinBoxFill,
	},
	{
		label: "Twitter",
		href: "https://www.twitter.com/profile.php?id=100093141111111",
		icon: RiTwitterXFill,
	},
	{
		label: "Facebook",
		href: "https://www.facebook.com/profile.php?id=100093141111111",
		icon: RiFacebookCircleFill,
	},
];
