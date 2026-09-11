import type { ReactNode } from "react";

export function SkipLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a href={href} className="sr-only focus:not-sr-only focus:absolute focus:start-0 focus:top-0 focus:z-[999] focus:rounded-lg focus:bg-background_light focus:p-4 focus:text-black dark:focus:bg-background dark:focus:text-white">
			{children}
		</a>
	);
}
