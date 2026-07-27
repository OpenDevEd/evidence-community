"use client";

import { usePathname } from "next/navigation";
import { twMerge } from "tailwind-merge";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export default function MainWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();
	const isMapPage = pathname.includes("/map");
	const { theme } = useLibraryConfig();

	return (
		<div
			className={twMerge(
				"h-full w-full bg-background_light dark:bg-background flex flex-col items-center justify-items-center min-h-screen",
				theme.layout === "small" && "xl:pt-14",
				isMapPage && "!p-0"
			)}
		>
			{children}
		</div>
	);
}
