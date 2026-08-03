import type { DoiDisplayLink } from "@opendeved/doi-sync-core/display";
import { twMerge } from "tailwind-merge";

export default function CitationDoiLink({
	link,
	className,
}: {
	link: DoiDisplayLink;
	className?: string;
}) {
	return (
		<a
			href={link.url}
			target="_blank"
			rel="noopener noreferrer"
			className={twMerge(
				"text-link_light hover:underline dark:text-link",
				className,
			)}
		>
			{link.value}
		</a>
	);
}
