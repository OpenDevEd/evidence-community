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
					"cursor-pointer hover:brightness-90 hover:scale-95 active:scale-105"
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

	return (
		<Skeleton
			isLoaded={isLoaded}
			className="flex h-9 w-auto min-w-0 max-w-logo-header shrink items-center justify-center rounded-lg xl:h-10"
		>
			{interactive ? <Link href={homeLink}>{logoContent}</Link> : logoContent}
		</Skeleton>
	);
}
