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
            label: "home",
            href: "/lib",
            navExclude: true,
        },
        {
            label: "aboutUs",
            href: "/about-us",
            icon: AboutUs,
        },
        {
            label: "evidenceLibrary",
            href: "/lib",
            icon: EvidenceLibrary,
        },
        {
            label: "programs",
            href: "/programs",
            icon: Programs,
        },
        {
            label: "blog",
            href: "/blog",
            icon: Blog,
        },
        {
            label: "team",
            href: "/team",
            icon: Team,
        },
        {
            label: "contactUs",
            href: "/contact-us",
            icon: ContactUs,
            footerExclude: true,
        },
    ],
    edtechhub: [
        {
            label: "home",
            href: "/lib",
            navExclude: true,
        },
        {
            label: "aboutUs",
            href: "/about-us",
            icon: RiTeamFill,
        },
        {
            label: "tools",
            href: "/tools",
            icon: RiToolsFill,
        },
        {
            label: "evidence",
            href: "/lib",
            icon: RiBookOpenFill,
            dropdown: [
                {
                    label: "aboutEvidenceInEdtech",
                    href: "/blog/about-evidence-in-edtech",
                },
                {
                    label: "evidenceLibrary",
                    href: "/lib",
                },
                {
                    label: "countryEngagement",
                    href: "/country-engagement",
                },
                {
                    label: "topicAreas",
                    href: "/topic-areas",
                },
                {
                    label: "researchPortfolio",
                    href: "/research-portfolio",
                },
                {
                    label: "sandboxes",
                    href: "/sandboxes",
                },
                {
                    label: "helpdesk",
                    href: "/helpdesk",
                },
            ],
        },
        {
            label: "blog",
            href: "/blog",
            icon: GiBookshelf,
        },
        {
            label: "connectWithUs",
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
