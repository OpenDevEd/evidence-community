"use client";

import { usePathname } from "next/navigation";
import { style } from "../../../tailwind.config";

import { twMerge } from "tailwind-merge";
import { isPathSmallNavbar } from "@/lib/utils";

export default function MainWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();
	const isMapPage = isPathSmallNavbar(pathname);
    
	return (
		<div
			className={twMerge(
				"h-full w-full bg-background_light dark:bg-background flex flex-col items-center justify-items-center min-h-screen",
				style === "small" && "xl:pt-14",
				isMapPage && "!p-0"
			)}
		>
			{children}
		</div>
	);
}
