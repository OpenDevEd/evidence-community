import { getFormatter, getLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { PdfCover } from "@/components/features/items/PdfCover";
import { getLibraryConfig } from "@/config/library-config/server";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import { loadLibraryHighlights } from "@/components/pages/home-data";
import { LibraryPageLinks } from "./LibraryPageLinks";

const CARD = "w-full bg-card_light dark:bg-card rounded-2xl p-6 flex flex-col gap-4";
const HEADING = "text-lg font-medium text-black/80 dark:text-white/80";
const ROW = "group flex min-w-0 gap-4 rounded-xl p-2 -mx-2 outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-white/5";

/** The library as a whole, under the filters: what is cited most, the latest digests, and the pages that show all of it. */
export async function LibraryHighlights() {
	const [locale, format, config] = await Promise.all([getLocale(), getFormatter(), getLibraryConfig()]);
	const { cited, digests } = await loadLibraryHighlights(locale);
	const hasMap = getRuntimePageAvailability(config)["/map"];

	return (
		<div className="flex flex-col gap-4">
			{cited.length > 0 && (
				<section className={CARD} aria-labelledby="highlights-cited">
					<h4 id="highlights-cited" className={HEADING}>Most cited</h4>
					<ol className="flex flex-col gap-2">
						{cited.map((row) => (
							<li key={row.key}>
								<Link href={`/lib/${row.key}`} className={ROW}>
									<span className="block w-12 shrink-0 self-start overflow-hidden rounded-md shadow-sm [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
										<PdfCover src={row.cover} alt="" width={48} title={row.title} />
									</span>
									<span className="flex min-w-0 flex-1 flex-col gap-1">
										<span className="line-clamp-2 text-base font-medium leading-snug text-black/80 transition-colors group-hover:text-accent dark:text-white/80">{row.title}</span>
										<span className="text-sm tabular-nums text-black/60 dark:text-white/60">
											{format.number(row.citations)} {row.citations === 1 ? "citation" : "citations"}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ol>
				</section>
			)}
			{digests && digests.editions.length > 0 && (
				<section className={CARD} aria-labelledby="highlights-digests">
					<div className="flex items-baseline justify-between gap-4">
						<h4 id="highlights-digests" className={HEADING}>Latest digests</h4>
						<Link href="/digests" className="text-sm font-medium text-accent hover:underline">All digests</Link>
					</div>
					<ol className="flex flex-col gap-2">
						{digests.editions.map((edition) => (
							<li key={edition.slug}>
								<Link href={`/digests/${edition.slug}`} className={`${ROW} flex-col gap-1`}>
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
			<LibraryPageLinks map={hasMap} />
		</div>
	);
}
