"use client";

import { twMerge } from "@/lib/tw-merge";

import {
	LibraryLogo,
	useLibraryLogo,
} from "@/components/library/LibraryIdentity";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link } from "@/i18n/routing";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getRuntimeHomeHref } from "@/config/library-config/links";

interface LogoProps {
	interactive?: boolean;
}

/**
 * The library's name beside its logo: the full name, and the short one where it differs. The header's measured widths show the
 * one that fits, or neither (navbar-fit); both are hidden until then.
 */
function LogoName() {
	const { identity } = useLibraryConfig();
	if (!identity.showName) return null;
	// Should the measured widths ever be off, the name gives way to the logo rather than squeezing it, the gap before it too.
	const name = "nf-name min-w-0 shrink-[1000] overflow-hidden";
	const text = "block truncate ps-3 text-2xl font-medium leading-tight tracking-tight text-black dark:text-white";
	return (
		<>
			<span className={twMerge(name, "nf-name-full")}>
				<span className={text}>{identity.name}</span>
			</span>
			{identity.shortName !== identity.name && (
				<span aria-hidden className={twMerge(name, "nf-name-short")}>
					<span className={text}>{identity.shortName}</span>
				</span>
			)}
		</>
	);
}

export function Logo({ interactive = true }: LogoProps) {
	const { isLoaded, onLogoSettled } = useLibraryLogo();
	const { navigation } = useLibraryConfig();
	const homeLink = getRuntimeHomeHref(navigation.links);

	const logoContent = (
		<div
			className={twMerge(
				"select-none opacity-0 motion-safe:transition-[opacity,filter,transform] motion-safe:duration-500 motion-safe:ease-out motion-reduce:transition-none",
				isLoaded && "opacity-100",
				interactive &&
					"cursor-pointer group-hover:brightness-90 group-hover:scale-95 group-active:scale-105"
			)}
		>
			<LibraryLogo
				className={twMerge(
					"pointer-events-none",
					// While the picture is on its way the box holds the logo's
					// width as the server measured it (navbar-fit), or the widest a
					// logo may be without a measurement, so the name and links
					// beside it don't move when it lands.
					isLoaded ? "w-auto" : "w-[var(--nf-logo-width,12rem)]",
				)}
				place="header"
				onSettled={onLogoSettled}
			/>
		</div>
	);

	const content = (
		<>
			<Skeleton
				isLoaded={isLoaded}
				className="flex h-9 w-auto min-w-0 max-w-logo-header shrink items-center justify-center rounded-lg xl:h-10"
			>
				{logoContent}
			</Skeleton>
			<LogoName />
		</>
	);

	return interactive ? (
		<Link href={homeLink} className="group flex min-w-0 shrink items-center">
			{content}
		</Link>
	) : (
		<div className="flex min-w-0 shrink items-center">{content}</div>
	);
}
