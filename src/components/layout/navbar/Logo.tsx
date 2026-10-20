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
	const name = "nf-name whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight text-black dark:text-white";
	return (
		<>
			<span className={twMerge(name, "nf-name-full")}>{identity.name}</span>
			{identity.shortName !== identity.name && (
				<span aria-hidden className={twMerge(name, "nf-name-short")}>{identity.shortName}</span>
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
					// While the picture is on its way the box holds the widest
					// a logo may be, so the bar does not jump when it lands.
					// Once it is there the box is only as wide as the logo.
					isLoaded ? "w-auto" : "w-logo-header",
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
		<Link href={homeLink} className="group flex min-w-0 shrink items-center gap-3">
			{content}
		</Link>
	) : (
		<div className="flex min-w-0 shrink items-center gap-3">{content}</div>
	);
}
