import type { AdminFieldErrors } from "@/lib/admin/errors";

function canonicalAdminValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalAdminValue);
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalAdminValue(record[key])]),
		);
	}
	return value;
}

function valuesEqual(left: unknown, right: unknown) {
	if (Object.is(left, right)) return true;
	return (
		JSON.stringify(canonicalAdminValue(left)) ===
		JSON.stringify(canonicalAdminValue(right))
	);
}

export function clearChangedAdminFieldErrors(
	errors: AdminFieldErrors,
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
) {
	if (Object.keys(errors).length === 0) return errors;
	const changedFields = new Set(
		[...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
			(field) => !valuesEqual(previous[field], next[field]),
		),
	);
	if (changedFields.size === 0) return errors;

	const remaining = Object.fromEntries(
		Object.entries(errors).filter(([path]) => {
			if (path === "_form") return false;
			const [field] = path.split(".");
			return field ? !changedFields.has(field) : true;
		}),
	);
	return Object.keys(remaining).length === Object.keys(errors).length
		? errors
		: remaining;
}

export function firstAdminFieldError(errors: AdminFieldErrors, field: string) {
	return Object.entries(errors).find(
		([path]) => path === field || path.startsWith(`${field}.`),
	)?.[1];
}

export function shouldClearAdminValidationErrors({
	currentKey,
	currentPayload,
	nextKey,
	nextPayload,
	replaceLocal,
}: {
	currentKey: string | undefined;
	currentPayload: Record<string, unknown>;
	nextKey: string;
	nextPayload: Record<string, unknown>;
	replaceLocal: boolean;
}) {
	return (
		replaceLocal ||
		currentKey !== nextKey ||
		!valuesEqual(currentPayload, nextPayload)
	);
}

export function validationTargetId(recordKey: string, path: string) {
	const [field, index, creatorField] = path.split(".");
	if (field === "_form" || field === "parentItem") {
		return null;
	}
	if (field === "collections" || field === "tags") {
		return `admin-${recordKey}-${field}`;
	}
	if (field === "creators" && index && /^\d+$/u.test(index)) {
		const suffix = creatorField === "creatorType" ? "role" : null;
		return suffix
			? `admin-creator-${index}-${suffix}`
			: `admin-creator-${index}`;
	}
	return `admin-${recordKey}-${field}`;
}
