"use client";

import { usePathname } from "next/navigation";
import { style } from "../../../tailwind.config";

import { twMerge } from "tailwind-merge";
import { useInlineChatLayout } from "@/context/InlineChatLayout";

export default function MainWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();
	const isMapPage = pathname.includes("/map");
	const { engaged } = useInlineChatLayout();

	return (
		<div
			className={twMerge(
				"h-full w-full bg-background_light dark:bg-background flex flex-col items-center justify-items-center min-h-screen",
				// Small style floats the header 3.5rem below the top. In split
				// chat mode the header is scaled to 75% and the content sits
				// 1.625rem under it; match that above so the header is evenly
				// spaced instead of leaving a band of dead space at the top.
				// Same clock as the rest of the split-view reflow.
				style === "small" &&
					"xl:pt-14 transition-[padding] duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
				style === "small" && engaged && "xl:pt-[1.625rem]",
				isMapPage && "!p-0"
			)}
		>
			{children}
		</div>
	);
}
