import type { DoiDisplayLink } from "@opendeved/doi-sync-core/display";

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
			className={`text-link_light transition-colors hover:underline dark:text-link${className ? ` ${className}` : ""}`}
		>
			{link.url}
		</a>
	);
}
