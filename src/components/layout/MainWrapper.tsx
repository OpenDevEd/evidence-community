"use client";

import { usePathname } from "next/navigation";
import { twMerge } from "tailwind-merge";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

/**
 * The space above the header. The small style floats the header below the top
 * of the page; while the chat is open the header shrinks and moves up, so the
 * space above it closes by the same amount.
 */
function headroom(floats: boolean, engaged: boolean) {
	if (!floats) return undefined;

	return twMerge(
		"transition-page-space duration-split ease-split",
		engaged ? "xl:pt-split" : "xl:pt-14",
	);
}

export default function MainWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();
	const { theme } = useLibraryConfig();
	const { engaged } = useInlineChatLayout();

	return (
		<div
			className={twMerge(
				"h-full w-full bg-background_light dark:bg-background flex flex-col items-center justify-items-center min-h-screen",
				headroom(theme.layout === "small", engaged),
				// The map fills the page on its own.
				pathname.includes("/map") && "!p-0",
			)}
		>
			{children}
		</div>
	);
}
