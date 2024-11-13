import AboutUs from "@/components/icons/AboutUs";
import EvidenceLibrary from "@/components/icons/EvidenceLibrary";
import Programs from "@/components/icons/Programs";
import Blog from "@/components/icons/Blog";
import Team from "@/components/icons/Team";
import ContactUs from "@/components/icons/ContactUs";
import { RiFacebookCircleFill, RiLinkedinBoxFill, RiTwitterXFill } from "react-icons/ri";

export const links = [
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
    href: "/",
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
];

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
