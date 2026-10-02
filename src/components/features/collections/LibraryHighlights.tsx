import { getFormatter, getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import { loadLatestDigests } from "@/components/pages/home-data";
import { LibraryPageLinks } from "./LibraryPageLinks";

const CARD = "w-full bg-card_light dark:bg-card rounded-2xl p-6 flex flex-col gap-4";
const HEADING = "text-lg font-medium text-black/80 dark:text-white/80";
const ROW = "group flex min-w-0 flex-col gap-1 rounded-xl p-2 -mx-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5";

/** The library as a whole, under the filters: its latest digests, and the pages that show the results another way. */
export async function LibraryHighlights() {
	const [locale, format, config] = await Promise.all([getLocale(), getFormatter(), getLibraryConfig()]);
	const digests = await loadLatestDigests(locale);
	const pages = getRuntimePageAvailability(config);

	return (
		<div className="flex flex-col gap-4">
			{digests && digests.editions.length > 0 && (
				<section className={CARD} aria-labelledby="highlights-digests">
					<div className="flex items-baseline justify-between gap-4">
						<h4 id="highlights-digests" className={HEADING}>Latest digests</h4>
						<Link href="/digests" className="text-sm font-medium text-accent hover:underline">All digests</Link>
					</div>
					<ol className="flex flex-col gap-2">
						{digests.editions.map((edition) => (
							<li key={edition.slug}>
								<Link href={`/digests/${edition.slug}`} className={ROW}>
									<span className="text-sm tabular-nums text-black/60 dark:text-white/60">
										{format.dateTime(new Date(edition.published.at), { dateStyle: "medium" })}
									</span>
									<span className="line-clamp-2 text-base font-medium leading-snug text-black/80 transition-colors group-hover:text-accent dark:text-white/80">{edition.title}</span>
								</Link>
							</li>
						))}
					</ol>
				</section>
			)}
			<LibraryPageLinks map={pages["/map"]} statistics={pages["/statistics"]} />
		</div>
	);
}
