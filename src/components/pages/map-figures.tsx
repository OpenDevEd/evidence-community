"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

/** A value as the map's lists, tooltips and key show it: whole records, or a rate to three figures. */
export function useValueFormat() {
	const format = useFormatter();
	return {
		rate: (value: number) => format.number(value, value >= 100 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 3 }),
		count: (value: number) => format.number(value),
	};
}

const strong = (value: ReactNode) => <strong className="font-semibold tabular-nums text-black dark:text-white">{value}</strong>;

/** Records for each million people, where `perMillion` gives a rate for them. */
function TipRate({ count, perMillion }: { count: number; perMillion?: (count: number) => number | null }) {
	const { rate } = useValueFormat();
	const t = useTranslations("ui");
	const people = perMillion?.(count) ?? null;
	if (people === null) return null;
	return <span>{t.rich("mapPerMillionValue", { value: rate(people), number: strong })}</span>;
}

/** One line of a tooltip's figures: what they count, when there are two lines, then the records for each million people and the records. */
function TipLine({ label, count, perMillion }: { label?: string; count: number; perMillion?: (count: number) => number | null }) {
	const t = useTranslations("ui");
	return (
		<div className="flex gap-3 text-xs text-black/60 dark:text-white/60">
			{label && <span className="w-[4.5rem] shrink-0">{label}</span>}
			<TipRate count={count} perMillion={perMillion} />
			<span>{t.rich("resourcesCount", { count, number: strong })}</span>
		</div>
	);
}

/** A tooltip's figures: the whole library's (`total`, given only while a search, filter or chosen place narrows the map), then
 * the ones the map shows now. Without a total, one line. */
export function TipFigures({ total, count, perMillion }: { total: number | undefined; count: number; perMillion?: (count: number) => number | null }) {
	const t = useTranslations("ui");
	if (total === undefined) return <TipLine count={count} perMillion={perMillion} />;
	return (
		<div className="flex flex-col gap-0.5">
			<TipLine label={t("mapTipLibrary")} count={total} perMillion={perMillion} />
			<TipLine label={t("mapTipFiltered")} count={count} perMillion={perMillion} />
		</div>
	);
}
