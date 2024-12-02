import { twMerge } from "tailwind-merge";

export default function ResourceData({
	startContent,
	classNames,
	text,
}: {
	startContent?: React.ReactNode;
	classNames?: {
		container?: string;
		text?: string;
	};
	text: string | null;
}) {
	return (
		<div
			className={twMerge(
				"flex gap-2 items-center",
				classNames?.container
			)}
		>
			{startContent}
			<span
				className={twMerge(
					"text-black/60 dark:text-white/60 font-medium text-lg line-clamp-1",
					classNames?.text,
					!text && "!w-24"
				)}
			>
				{text}
			</span>
		</div>
	);
}