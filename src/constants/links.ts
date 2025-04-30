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
import { BsChatRightDotsFill, BsMapFill } from "react-icons/bs";
import { GiBookshelf } from "react-icons/gi";
import { LinkObject, LinksList } from "@/db/schema/tables/status";
import { LuX } from "react-icons/lu";
import { FaQuestionCircle } from "react-icons/fa";

export const NAVBAR_ICONS = {
    "AboutUs": AboutUs,
    "EvidenceLibrary": EvidenceLibrary,
    "Programs": Programs,
    "Blog": Blog,
    "Team": Team,
    "ContactUs": ContactUs,
    "TeamFill": RiTeamFill,
    "ToolsFill": RiToolsFill,
    "BookOpenFill": RiBookOpenFill,
    "Bookshelf": GiBookshelf,
    "ChatRightDotsFill": BsChatRightDotsFill,
    "BsMapFill": BsMapFill,
    "LuX": LuX,
    "FaQuestionCircle": FaQuestionCircle,
}

export const links: {
    [key: string]: Array<LinkObject & {
        icon?: keyof typeof NAVBAR_ICONS;
    }>;
} = {
    small: [
        {
            label: "home",
            href: "/lib",
            navExclude: true,
        },
        {
            label: "aboutUs",
            href: "/about-us",
            icon: "AboutUs",
        },
        {
            label: "evidenceLibrary",
            href: "/lib",
            icon: "EvidenceLibrary",
        },
        {
            label: "programs",
            href: "/programs",
            icon: "Programs",
        },
        {
            label: "blog",
            href: "/blog",
            icon: "Blog",
        },
        {
            label: "team",
            href: "/team",
            icon: "Team",
        },
        {
            label: "contactUs",
            href: "/contact-us",
            icon: "ContactUs",
            footerExclude: true,
        },
    ],
    wide: [
        {
            label: "home",
            href: "/lib",
            navExclude: true,
        },
        {
            label: "aboutUs",
            href: "/about-us",
            icon: "TeamFill",
        },
        {
            label: "tools",
            href: "/tools",
            icon: "ToolsFill",
        },
        {
            label: "evidence",
            href: "/lib",
            icon: "BookOpenFill",
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
            icon: "Bookshelf",
        },
        {
            label: "connectWithUs",
            href: "/contact-us",
            icon: "ChatRightDotsFill",
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
