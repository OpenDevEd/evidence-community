/** A paper as a list of them shows it: its title, first authors and year. */
export type PaperSummary = { title: string; authors: string; year: number | null };

type Creator = { firstName?: unknown; lastName?: unknown; name?: unknown };

/** The title, first authors and year a record's payload or row holds. */
export function summaryOf(record: { title?: unknown; creators?: unknown; date?: unknown }): PaperSummary {
	const names = (Array.isArray(record.creators) ? (record.creators as Creator[]) : []).flatMap((creator) => {
		const name = typeof creator.name === "string" ? creator.name : [creator.firstName, creator.lastName].filter((part) => typeof part === "string" && part).join(" ");
		return name ? [name] : [];
	});
	const year = typeof record.date === "string" ? Number(record.date.match(/\b(\d{4})\b/u)?.[1]) || null : null;
	return {
		title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled",
		authors: names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", "),
		year,
	};
}
