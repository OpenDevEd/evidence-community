"use client";

import { useLibraryConfig } from "@/context/LibraryConfigProvider";

/** The owner's one-line tagline under the library title. Renders nothing when unset. */
export function LibraryTagline({ show }: { show: boolean }) {
	const { identity } = useLibraryConfig();
	if (!show || !identity.tagline) return null;
	return (
		<p data-library-tagline="" className="text-lg text-black/60 dark:text-white/60">
			{identity.tagline}
		</p>
	);
}
