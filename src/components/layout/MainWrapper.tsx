"use client";

import { usePathname } from "next/navigation";
import { style } from "../../../tailwind.config";

import { twMerge } from "tailwind-merge";

export default function MainWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();
	const isMapPage = pathname.includes("/map");
	const isGapMapPage = pathname.includes("/gapmap");

	return (
		<div
			className={twMerge(
				"h-full w-full bg-background_light dark:bg-background flex flex-col items-center justify-items-center min-h-screen",
				style === "small" && "xl:pt-14",
				isMapPage && "!p-0",
				isGapMapPage && "h-screen",
				isGapMapPage && style === "small" && "xl:!pt-6"
			)}
		>
			{children}
		</div>
	);
}
