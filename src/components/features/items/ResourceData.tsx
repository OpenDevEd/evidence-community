import { twMerge } from "tailwind-merge";
import React from "react";

export default function ResourceData({
	element,
	startContent,
	classNames,
	text,
	datetime,
}: {
	element?: "time" | "span";
	startContent?: React.ReactNode;
	classNames?: {
		container?: string;
		text?: string;
	};
	text: string | null;
	datetime?: string;
}) {
	return (
		<div
			className={twMerge(
				"flex gap-2 items-center",
				classNames?.container
			)}
		>
			{startContent}
			{React.createElement(element || 'span', {
				dateTime: datetime,
				className: twMerge(
					"text-black/60 dark:text-white/60 font-medium text-lg line-clamp-1",
					classNames?.text,
					!text && "!w-24"
				),
				children: text
			})}
		</div>
	);
}