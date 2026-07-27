import type { ComponentType, SVGProps } from "react";
import { BsChatRightDotsFill, BsMapFill } from "react-icons/bs";
import { FaQuestionCircle } from "react-icons/fa";
import { GiBookshelf } from "react-icons/gi";
import { IoStatsChart } from "react-icons/io5";
import { LuX } from "react-icons/lu";
import {
	RiBookOpenFill,
	RiTeamFill,
	RiToolsFill,
} from "react-icons/ri";

import AboutUs from "@/components/icons/AboutUs";
import Blog from "@/components/icons/Blog";
import ContactUs from "@/components/icons/ContactUs";
import EvidenceLibrary from "@/components/icons/EvidenceLibrary";
import Programs from "@/components/icons/Programs";
import Team from "@/components/icons/Team";
import {
	PLATFORM_NAVBAR_ICON_IDS,
	type PlatformNavbarIconId,
} from "@/config/library-config/catalogs";

type PlatformIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const PLATFORM_ICON_COMPONENTS = {
	AboutUs,
	EvidenceLibrary,
	Programs,
	Blog,
	Team,
	ContactUs,
	TeamFill: RiTeamFill,
	ToolsFill: RiToolsFill,
	BookOpenFill: RiBookOpenFill,
	Bookshelf: GiBookshelf,
	ChatRightDotsFill: BsChatRightDotsFill,
	BsMapFill,
	LuX,
	FaQuestionCircle,
	IoStatsChart,
} satisfies Record<PlatformNavbarIconId, PlatformIconComponent>;

const platformIconIds = new Set<string>(PLATFORM_NAVBAR_ICON_IDS);

function isPlatformIconId(reference: string): reference is PlatformNavbarIconId {
	return platformIconIds.has(reference);
}

export function RuntimeAsset({
	reference,
	alt,
	className,
	width = 24,
	height = 24,
}: {
	reference: string;
	alt: string;
	className?: string;
	width?: number;
	height?: number;
}) {
	if (isPlatformIconId(reference)) {
		const Icon = PLATFORM_ICON_COMPONENTS[reference];

		return (
			<Icon
				aria-hidden={alt ? undefined : true}
				aria-label={alt || undefined}
				role={alt ? "img" : undefined}
				className={className}
				data-runtime-asset="platform"
				data-platform-icon={reference}
			/>
		);
	}

	if (!reference.startsWith("https://")) return null;

	return (
		// Runtime uploads cannot depend on a build-time Next.js image allowlist.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={reference}
			alt={alt}
			width={width}
			height={height}
			className={className}
			data-runtime-asset="remote"
			draggable={false}
		/>
	);
}
