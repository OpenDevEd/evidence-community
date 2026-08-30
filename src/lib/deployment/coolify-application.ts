export function isCoolifyApplicationUuid(
	value: unknown,
): value is string {
	return typeof value === "string" && /^[a-z0-9]{24}$/u.test(value);
}
