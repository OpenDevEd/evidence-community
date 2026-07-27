"use client";

import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { LibraryLogoImages } from "@/components/library/LibraryIdentity";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link } from "@/i18n/routing";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getRuntimeHomeHref } from "@/config/library-config/links";

interface LogoProps {
	interactive?: boolean;
}

export function Logo({ interactive = true }: LogoProps) {
	const [isLoaded, setIsLoaded] = useState(false);
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
			<LibraryLogoImages
				className="pointer-events-none h-auto max-h-full w-auto max-w-full"
				onLoad={() => setIsLoaded(true)}
			/>
		</div>
	);

	return (
		<Skeleton
			isLoaded={isLoaded}
			className="w-[10.6875rem] h-[2.5rem] rounded-lg flex justify-center items-center"
		>
			{interactive ? <Link href={homeLink}>{logoContent}</Link> : logoContent}
		</Skeleton>
	);
}

export default Logo;
