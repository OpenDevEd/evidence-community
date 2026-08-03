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
				"font-medium text-link_light underline decoration-black/15 underline-offset-4 transition-colors hover:text-link hover:decoration-current dark:text-link dark:decoration-white/20",
				className,
			)}
		>
			{link.url}
		</a>
	);
}
