"use client";

import { Analytics01Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useFiltersContext } from "@/context/FiltersProvider";
import { serializeSearchParams } from "@/lib/searchParams";

/** The pages that show the library another way: the map, with the search and filters in use, and the statistics. Each only where the library has it. */
export function LibraryPageLinks({ map, statistics }: { map: boolean; statistics: boolean }) {
	const { queryParams } = useFiltersContext();
	const t = useTranslations("sidebar");
	if (!map && !statistics) return null;
	// The map has no pages or order, only what the results are.
	const { page, sort, ...filters } = queryParams;
	return (
		<nav aria-label={t("morePages")} className="flex gap-2">
			{map && (
				<Button as={Link} role="link" href={`/map${serializeSearchParams(filters)}`} className="flex-1" startContent={<HugeiconsIcon icon={Globe02Icon} aria-hidden className="size-5" />}>
					{t("showOnMap")}
				</Button>
			)}
			{statistics && (
				<Button as={Link} role="link" href="/statistics" className="flex-1" startContent={<HugeiconsIcon icon={Analytics01Icon} aria-hidden className="size-5" />}>
					{t("statistics")}
				</Button>
			)}
		</nav>
	);
}
