function equalJsonValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => equalJsonValue(value, right[index]))
		);
	}
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return false;
	}

	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] &&
				equalJsonValue(leftRecord[key], rightRecord[key]),
		)
	);
}

export function applyItemDraftPatch(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
) {
	const effective = { ...base };
	for (const [field, value] of Object.entries(patch)) {
		if (value === null) {
			delete effective[field];
		} else {
			effective[field] = value;
		}
	}
	return effective;
}

export function createItemDraftPatch(
	base: Record<string, unknown>,
	next: Record<string, unknown>,
) {
	const patch: Record<string, unknown> = {};
	const fields = new Set([...Object.keys(base), ...Object.keys(next)]);
	for (const field of fields) {
		const baseHasField = Object.hasOwn(base, field);
		const nextHasField = Object.hasOwn(next, field);
		if (!nextHasField) {
			if (baseHasField) patch[field] = null;
			continue;
		}
		const nextValue = next[field];
		if (!baseHasField || !equalJsonValue(base[field], nextValue)) {
			patch[field] = nextValue;
		}
	}
	return patch;
}

export function effectiveItemParent(
	publishedParent: string | null | undefined,
	patch: Record<string, unknown> | null | undefined,
) {
	if (!patch || !Object.hasOwn(patch, "parentItem")) {
		return publishedParent ?? null;
	}
	return typeof patch.parentItem === "string" ? patch.parentItem : null;
}
