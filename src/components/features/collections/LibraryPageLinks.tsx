"use client";

import { Analytics01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Link } from "@/i18n/routing";

/** The pages that show the whole library: its map, when the library has one, and its statistics. */
export function LibraryPageLinks({ map }: { map: boolean }) {
	return (
		<nav aria-label="More of the library" className="flex gap-2">
			{map && (
				<Button as={Link} role="link" href="/map" className="flex-1" startContent={<HugeiconsIcon icon={Globe02Icon} aria-hidden className="size-5" />}>
					Map
				</Button>
			)}
			<Button as={Link} role="link" href="/statistics" className="flex-1" startContent={<HugeiconsIcon icon={Analytics01Icon} aria-hidden className="size-5" />}>
				Statistics
			</Button>
		</nav>
	);
}
