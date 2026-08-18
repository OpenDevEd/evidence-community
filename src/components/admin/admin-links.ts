import type {
	AdminItemLinkKind,
	AdminItemLinks,
	AdminLinkTarget,
	AdminSource,
} from "@/lib/admin/types";

export type AdminLinkChange = "added" | "removed" | "unchanged";

export type AdminLinkRowPlan = {
	change: AdminLinkChange;
	deleted: boolean;
	itemType: string;
	key: string;
	kind: AdminItemLinkKind;
	/** `manual` or `source:<key>` */
	origin: string;
	/** Editor can remove this row (manual rows only). */
	removable: boolean;
	sourceLabel: string | null;
	title: string;
};

export type AdminLinksPlan = {
	outgoing: Record<AdminItemLinkKind, AdminLinkRowPlan[]>;
	incoming: Record<AdminItemLinkKind, AdminLinkRowPlan[]>;
};

export const ADMIN_LINK_KINDS: readonly AdminItemLinkKind[] = ["cites", "related"];

export function sourceLabelForOrigin(
	origin: string,
	sources: readonly AdminSource[],
): string | null {
	if (!origin.startsWith("source:")) return null;
	const key = origin.slice("source:".length);
	return sources.find((source) => source.key === key)?.label ?? key;
}

/**
 * Builds what the Links section shows: outgoing rows per kind (drafted, removed,
 * and source-owned) and incoming rows per kind. Pure, so it can be unit tested.
 */
export function planAdminLinks({
	keys,
	knownTargets,
	links,
	sources,
}: {
	/** Draft outgoing manual keys, per kind. */
	keys: Record<AdminItemLinkKind, string[]>;
	/** Targets picked in this session that the server detail does not know yet. */
	knownTargets: readonly AdminLinkTarget[];
	links: AdminItemLinks;
	sources: readonly AdminSource[];
}): AdminLinksPlan {
	const targetByKey = new Map<string, AdminLinkTarget>();
	for (const target of [...links.targets, ...knownTargets]) {
		targetByKey.set(target.key, target);
	}
	const describe = (key: string) => {
		const target = targetByKey.get(key);
		return {
			deleted: target?.deleted ?? false,
			itemType: target?.itemType ?? "",
			key,
			title: target?.title ?? key,
		};
	};

	const outgoing = { cites: [] as AdminLinkRowPlan[], related: [] as AdminLinkRowPlan[] };
	for (const kind of ADMIN_LINK_KINDS) {
		const drafted = [...new Set(keys[kind])];
		const published = new Set(links.publishedKeys[kind]);
		for (const key of drafted) {
			outgoing[kind].push({
				...describe(key),
				change: published.has(key) ? "unchanged" : "added",
				kind,
				origin: "manual",
				removable: true,
				sourceLabel: null,
			});
		}
		for (const key of links.publishedKeys[kind]) {
			if (drafted.includes(key)) continue;
			outgoing[kind].push({
				...describe(key),
				change: "removed",
				kind,
				origin: "manual",
				removable: false,
				sourceLabel: null,
			});
		}
		for (const row of links.fromSources) {
			if (row.kind !== kind) continue;
			if (outgoing[kind].some((existing) => existing.key === row.key)) continue;
			outgoing[kind].push({
				...describe(row.key),
				change: "unchanged",
				kind,
				origin: row.origin,
				removable: false,
				sourceLabel: sourceLabelForOrigin(row.origin, sources),
			});
		}
	}

	const incoming = { cites: [] as AdminLinkRowPlan[], related: [] as AdminLinkRowPlan[] };
	for (const row of links.incoming) {
		if (incoming[row.kind].some((existing) => existing.key === row.key)) continue;
		incoming[row.kind].push({
			...describe(row.key),
			change: "unchanged",
			kind: row.kind,
			origin: row.origin,
			removable: false,
			sourceLabel: sourceLabelForOrigin(row.origin, sources),
		});
	}

	return { incoming, outgoing };
}

/** Records the picker may offer: not this record, not already linked under this kind. */
export function pickableLinkTargets<T extends { key: string }>(
	rows: readonly T[],
	{ excludeKeys, selfKey }: { excludeKeys: readonly string[]; selfKey: string },
): T[] {
	const excluded = new Set([selfKey, ...excludeKeys]);
	return rows.filter((row) => !excluded.has(row.key));
}
