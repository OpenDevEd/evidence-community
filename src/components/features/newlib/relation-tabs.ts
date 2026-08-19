import type { ItemLinks } from "@/app/api/item/types";
import type { RelationsType } from "@/types/item";

export type RelationTabKey = "general" | "cites" | "citedBy";

export type RelationTabPlan = {
	key: RelationTabKey;
	keys: string[];
};

const TAB_ORDER: RelationTabKey[] = ["general", "cites", "citedBy"];

function tailKeys(value: unknown): string[] {
	let values: unknown[] = [];
	if (Array.isArray(value)) values = value;
	else if (value) values = [value];
	return values.flatMap((entry) => {
		if (typeof entry !== "string") return [];
		const key = entry.split("/").findLast((part) => part.length > 0);
		return key ? [key] : [];
	});
}

function unique(keys: string[]) {
	return [...new Set(keys)];
}

/**
 * Decides which relation tabs to show and what each lists.
 * "Related resources" = record links of kind `related` (both directions) plus
 * read-only provider keys (`owl:sameAs`, `related_works`).
 * Tabs with nothing to show are hidden; the first tab stays when all are empty.
 */
export function planRelationTabs({
	activeTab,
	links,
	relations,
}: {
	activeTab: string;
	links: ItemLinks | undefined;
	relations: RelationsType;
}): { tabs: RelationTabPlan[]; activeTab: RelationTabKey } {
	const relationsObject = relations ?? {};
	const keysByTab: Record<RelationTabKey, string[]> = {
		general: unique([
			...(links?.related ?? []),
			...tailKeys(relationsObject["owl:sameAs"]),
			...tailKeys(relationsObject["related_works"]),
		]),
		cites: unique(links?.cites ?? []),
		citedBy: unique(links?.citedBy ?? []),
	};
	const visible = TAB_ORDER.filter((key) => keysByTab[key].length > 0);
	const tabKeys = visible.length > 0 ? visible : ["general" as const];
	const tabs = tabKeys.map((key) => ({ key, keys: keysByTab[key] }));
	const active = tabKeys.includes(activeTab as RelationTabKey)
		? (activeTab as RelationTabKey)
		: tabKeys[0]!;
	return { tabs, activeTab: active };
}
