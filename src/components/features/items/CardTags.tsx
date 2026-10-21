"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
import { Link } from "@/i18n/routing";
import type { CardTag } from "@/lib/card-tags";
import { serializeSearchParams } from "@/lib/searchParams";
import { twMerge } from "@/lib/tw-merge";
import { localizeOrUseIfCapitalized } from "@/lib/utils";

/**
 * A record rarely sits in more groups than this; the rest wait behind a count, so a card never grows a block of tags. A
 * narrow card shows one fewer: the last is hidden there, and the count shown counts it.
 */
const SHOWN = 3;
const WIDE_ONLY = "hidden @[380px]:inline-flex";

const SHAPE = "inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium outline-offset-2 transition-colors";
const PLAIN = "bg-black/[0.05] text-black/70 dark:bg-white/[0.08] dark:text-white/75";
const PLAIN_HOVER = "hover:bg-black/10 hover:text-black/90 dark:hover:bg-white/15 dark:hover:text-white";
/** A chosen colour tints the tag, and its text is the colour darkened, or lightened in the dark, so any colour reads. */
const TINTED = "bg-[color:color-mix(in_oklab,var(--tag)_14%,transparent)] text-[color:color-mix(in_oklab,var(--tag),black_42%)] dark:bg-[color:color-mix(in_oklab,var(--tag)_24%,transparent)] dark:text-[color:color-mix(in_oklab,var(--tag),white_50%)]";
const TINTED_HOVER = "hover:bg-[color:color-mix(in_oklab,var(--tag)_24%,transparent)] dark:hover:bg-[color:color-mix(in_oklab,var(--tag)_34%,transparent)]";

/** One group the record is in, opening the list of the group's other records where readers can filter by it. */
function Tag({ tag, label, className }: { tag: CardTag; label: string; className?: string }) {
	const look = {
		className: twMerge(SHAPE, tag.color ? TINTED : PLAIN, tag.filter && (tag.color ? TINTED_HOVER : PLAIN_HOVER), className),
		style: tag.color ? ({ "--tag": tag.color } as CSSProperties) : undefined,
	};
	const content = (
		<>
			{tag.icon ? (
				<RuntimeAsset reference={tag.icon} alt="" width={14} height={14} className="size-3.5 shrink-0" />
			) : (
				<HugeiconsIcon icon={Folder01Icon} className={twMerge("size-3.5 shrink-0", !tag.color && "opacity-70")} aria-hidden />
			)}
			<span className="truncate">{tag.name}</span>
		</>
	);
	return tag.filter ? (
		<Link href={`/lib${serializeSearchParams(tag.filter)}`} aria-label={`${label}: ${tag.name}`} {...look}>
			{content}
		</Link>
	) : (
		<span aria-label={`${label}: ${tag.name}`} {...look}>{content}</span>
	);
}

/** The groups a record's card names it a member of: the first few as tags, the rest listed by group behind a count. */
export function CardTags({ tags, className }: { tags: CardTag[] | undefined; className?: string }) {
	const t = useTranslations("ui");
	if (!tags?.length) return null;
	// What the library calls its sources may be a message key; a collection's name is its own.
	const label = (tag: CardTag) => (tag.from === "sources" ? localizeOrUseIfCapitalized(tag.groupName, t) : tag.groupName);
	const hidden = tags.length - SHOWN;
	const last = tags[SHOWN - 1];
	// Each group keeps its tags together, a wider gap from the next group's; the count of the rest closes the last one.
	const groups = Object.values(Object.groupBy(tags.slice(0, SHOWN), (tag) => tag.group));
	return (
		<div className={twMerge("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
			{groups.map((members, index) => (
				<div key={members![0].group} className="flex min-w-0 flex-wrap items-center gap-1.5">
					{members!.map((tag) => <Tag key={tag.name} tag={tag} label={label(tag)} className={tag === last ? WIDE_ONLY : undefined} />)}
					{index === groups.length - 1 && tags.length >= SHOWN && <MoreTags tags={tags} hidden={hidden} label={label} />}
				</div>
			))}
		</div>
	);
}

/** How many more groups the record is in, opening every one of them by group name. */
function MoreTags({ tags, hidden, label }: { tags: CardTag[]; hidden: number; label: (tag: CardTag) => string }) {
	return (
		<Popover placement="bottom-end" offset={6}>
			<PopoverTrigger>
				<button type="button" className={twMerge(SHAPE, PLAIN, PLAIN_HOVER, "tabular-nums", hidden === 0 && "@[380px]:hidden")}>
					<span className="@[380px]:hidden">+{hidden + 1}<span className="sr-only"> more</span></span>
					{hidden > 0 && <span className="hidden @[380px]:inline">+{hidden}<span className="sr-only"> more</span></span>}
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-72 max-w-full items-stretch gap-3 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-secondary">
				{Object.entries(Object.groupBy(tags, (tag) => label(tag))).map(([group, members]) => (
					<section key={group} className="flex flex-col gap-1.5">
						<h4 className="px-1 text-xs font-medium text-black/50 dark:text-white/50">{group}</h4>
						<div className="flex flex-wrap gap-1.5">
							{members!.map((tag) => <Tag key={tag.name} tag={tag} label={group} />)}
						</div>
					</section>
				))}
			</PopoverContent>
		</Popover>
	);
}
