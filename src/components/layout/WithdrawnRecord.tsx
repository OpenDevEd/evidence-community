"use client";

import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArchiveIcon, LinkSquare02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { useFormatter, useTranslations } from "next-intl";
import type { WithdrawnRecord as Withdrawn } from "@/lib/withdrawn-record";
import PageContainer from "./PageContainer";

/**
 * A withdrawn record's page: its DOI still leads here, so it names the work, says when and why the community withdrew
 * it, and lists its DOIs. Its abstract and files are gone with it.
 */
export default function WithdrawnRecord({ record }: { record: Withdrawn }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const byline = [record.authors.join(", "), record.year].filter(Boolean);
	return (
		<PageContainer id="main-content" className="flex flex-1 flex-col items-center justify-center py-16">
			<article className="w-full max-w-xl space-y-6 text-black/80 dark:text-white/80">
				<header className="space-y-3">
					<p className="inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
						<HugeiconsIcon icon={ArchiveIcon} aria-hidden size={14} />
						{t("recordWithdrawnOn", { date: format.dateTime(new Date(record.withdrawnAt), { dateStyle: "long" }) })}
					</p>
					<h1 className="break-words text-2xl font-medium leading-snug sm:text-3xl">{record.title}</h1>
					{byline.length ? <p className="text-sm text-black/55 dark:text-white/55">{byline.join(", ")}</p> : null}
				</header>
				<p className="text-sm leading-6">{t("recordWithdrawnNote")}</p>
				{record.reason ? (
					<section aria-labelledby="withdrawal-reason" className="rounded-2xl bg-card_light p-4 dark:bg-card">
						<h2 id="withdrawal-reason" className="text-xs font-medium text-black/50 dark:text-white/50">
							{t("recordWithdrawnReason")}
						</h2>
						<p className="mt-1.5 whitespace-pre-line break-words text-sm leading-6">{record.reason}</p>
					</section>
				) : null}
				{record.dois.length ? (
					<ul className="space-y-2">
						{record.dois.map((doi) => (
							<li key={doi.value} className="flex min-w-0 flex-col gap-0.5">
								<span className="text-xs text-black/50 dark:text-white/50">{doi.label}</span>
								<a href={doi.url} target="_blank" rel="noopener noreferrer" dir="ltr" className="inline-flex min-w-0 items-center gap-1 break-all text-sm text-link hover:underline">
									{doi.value}
									<HugeiconsIcon icon={LinkSquare02Icon} aria-hidden size={12} className="shrink-0" />
								</a>
							</li>
						))}
					</ul>
				) : null}
				<Button as={Link} role="link" href="/lib" size="md" startContent={<HugeiconsIcon icon={Search01Icon} className="size-4" />}>
					{t("search")}
				</Button>
			</article>
		</PageContainer>
	);
}
