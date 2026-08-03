export function collectionDescendantKeys(
	rows: Array<{ key: string; parentCollection: string | null }>,
	rootKey: string,
) {
	const children = new Map<string, string[]>();
	for (const row of rows) {
		if (!row.parentCollection) continue;
		const current = children.get(row.parentCollection) ?? [];
		current.push(row.key);
		children.set(row.parentCollection, current);
	}

	const descendants = new Set<string>();
	const pending = [...(children.get(rootKey) ?? [])];
	while (pending.length > 0) {
		const key = pending.pop()!;
		if (descendants.has(key)) continue;
		descendants.add(key);
		pending.push(...(children.get(key) ?? []));
	}
	return descendants;
}
