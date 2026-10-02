import { connection } from "next/server";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import { loadLatestDigests } from "@/components/pages/home-data";
import { LibraryPageLinks } from "./LibraryPageLinks";
import { SidebarCard } from "./ResultsOverview";
import { DigestCover } from "@/components/digests/DigestCover";

const ROW = "group/row flex min-w-0 flex-col gap-1 rounded-xl p-2 -mx-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5";

/** The library as a whole, under the filters: its latest digests, and the pages that show the results another way. */
export async function LibraryHighlights() {
	// The library config is only known per request, so this never prerenders.
	await connection();
	const [locale, format, t, config] = await Promise.all([getLocale(), getFormatter(), getTranslations("sidebar"), getLibraryConfig()]);
	const digests = await loadLatestDigests(locale);
	const pages = getRuntimePageAvailability(config);
	const [latest, ...earlier] = digests?.editions ?? [];

	return (
		<div className="flex flex-col gap-4">
			{latest && digests && (
				<SidebarCard title={t("latestDigests")} link={{ href: "/digests", label: t("allDigests") }}>
					{/* The digests page's own cover, so an edition looks the same wherever it shows. */}
					<div className="px-3 pt-2">
						<DigestCover edition={latest} libraryName={digests.library} href={`/digests/${latest.slug}`} locale={locale} titleAs="h3" />
					</div>
					{earlier.length > 0 && (
						<ol className="flex flex-col gap-1">
							{earlier.map((edition) => (
								<li key={edition.slug}>
									<Link href={`/digests/${edition.slug}`} className={ROW}>
										<span className="text-sm tabular-nums text-black/60 dark:text-white/60">
											{format.dateTime(new Date(edition.published.at), { dateStyle: "medium" })}
										</span>
										<span className="line-clamp-2 font-heading text-base font-medium leading-snug text-black/80 transition-colors group-hover/row:text-accent dark:text-white/80">{edition.title}</span>
									</Link>
								</li>
							))}
						</ol>
					)}
				</SidebarCard>
			)}
			<LibraryPageLinks map={pages["/map"]} statistics={pages["/statistics"]} />
		</div>
	);
}
