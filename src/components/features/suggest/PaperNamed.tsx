"use client";

import { Chip } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckmarkCircle02Icon, File01Icon, InboxIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Spinner } from "@/components/nextui/Spinner";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { Link } from "@/i18n/routing";
import { call, namesPaper, STATE_OF, type Answer } from "./papers";
import { useSuggest } from "./SuggestPapers";

/**
 * Where the paper a search names stands, once the community has said: `looking` until then, and `unread` when it
 * wouldn't say (a visitor's lookups spent, a link that needs a sign-in). An unread paper can still be suggested: the
 * dialog reads it once the reader is signed in.
 */
type Standing = "looking" | "unread" | "found" | "here" | "waiting" | "missing";

/** What the line under the name says while there is no paper to describe. */
const SAID = { looking: "lookingUp", missing: "noPaperNamed" } as const;

/** The line under the paper's name: that it is being read, that none was found, or its authors and year. */
function NamedDetail({ standing, answer }: { standing: Standing; answer: Answer | undefined }) {
	const t = useTranslations("suggestPapers");
	if (standing === "unread") return null;
	if (standing in SAID) return <span>{t(SAID[standing as keyof typeof SAID])}</span>;
	return (
		<>
			<span className="truncate">{answer?.paper?.authors || t("noAuthors")}</span>
			{answer?.paper?.year ? <span className="shrink-0 tabular-nums">{answer.paper.year}</span> : null}
		</>
	);
}

/** A paper already in the community, or waiting for its team: said in a chip, with the way to open one that is here. */
function NamedStanding({ standing, itemKey }: { standing: "here" | "waiting"; itemKey: string | undefined }) {
	const t = useTranslations("suggestPapers");
	const here = standing === "here";
	return (
		<>
			<Chip variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" aria-hidden />}>{t(here ? "inCommunity" : "waiting")}</Chip>
			{here && itemKey ? <Button as={Link} href={`/lib/${itemKey}`} variant="bordered">{t("open")}</Button> : null}
		</>
	);
}

/** What the row offers at its end: the button that suggests the paper, or where the paper stands here. */
function NamedEnd({ standing, answer, onSuggest }: { standing: Standing; answer: Answer | undefined; onSuggest: () => void }) {
	const t = useTranslations("suggestPapers");
	if (standing === "missing") return null;
	if (standing === "here" || standing === "waiting") return <NamedStanding standing={standing} itemKey={answer?.itemKey} />;
	// The button holds its place while the paper is read, so nothing arrives beside the title.
	const reading = standing === "looking";
	return (
		<Button color="accent" variant="solid" className="flex-1 sm:flex-none" isDisabled={reading} onPress={onSuggest} startContent={reading ? <Spinner size="sm" color="current" /> : <HugeiconsIcon icon={InboxIcon} className="size-5" aria-hidden />}>
			{t("suggestThis")}
		</Button>
	);
}

function standingOf(answer: Answer | undefined, error: unknown): Standing {
	if (answer) return STATE_OF[answer.outcome];
	return error ? "unread" : "looking";
}

/**
 * Above a search's results when the search itself names a paper (a DOI, an OpenAlex ID or a paper's link): what the
 * paper is, and either where it is here or a button that suggests it. The row has its room from the first frame; the
 * paper's name fades into it once read. One that can't be read (a visitor's lookups spent, a link that needs a
 * sign-in) keeps its row and its button, under what was typed.
 */
export function PaperNamed({ search }: { search: string }) {
	const suggest = useSuggest();
	const raw = search.trim();
	const offered = useLibraryFeature("readerAccounts") && namesPaper(raw);
	const { data, error } = useSWR(offered ? ["suggest-named", raw] : null, () => call<Answer>(`?paper=${encodeURIComponent(raw)}`), { revalidateOnFocus: false });
	const standing = standingOf(data, error);
	return (
		<AnimatePresence initial={false}>
			{offered ? (
				<motion.div key="paper" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
					<div className="flex min-h-[4.75rem] flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-card_light px-4 py-3 dark:bg-card sm:flex-nowrap">
						<span className="flex size-11 shrink-0 items-center self-start justify-center rounded-xl bg-accent/10 text-accent">
							<HugeiconsIcon icon={File01Icon} className="size-6" aria-hidden />
						</span>
						<div className="min-w-0 flex-1 basis-48">
							<p className="line-clamp-2 font-medium sm:line-clamp-1">{data?.paper?.title ?? <span dir="ltr" className="break-all font-mono text-sm">{raw}</span>}</p>
							<p className="flex min-w-0 gap-2 text-sm text-foreground/60 dark:text-white/60">
								<NamedDetail standing={standing} answer={data} />
							</p>
						</div>
						<span className="flex h-10 w-full shrink-0 items-center gap-2 sm:w-auto">
							<NamedEnd standing={standing} answer={data} onSuggest={() => suggest(raw)} />
						</span>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
