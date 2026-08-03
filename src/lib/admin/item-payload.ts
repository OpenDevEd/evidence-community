export function stringList(value: unknown) {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

export function payloadStringList(payload: unknown, field: string) {
	return payload && typeof payload === "object"
		? stringList((payload as Record<string, unknown>)[field])
		: [];
}

export function collectionKeysFromPayload(payload: unknown) {
	return payloadStringList(payload, "collections");
}

export function payloadWithCollection(
	payload: Record<string, unknown>,
	collectionKey: string,
) {
	return {
		...payload,
		collections: [
			...new Set([...collectionKeysFromPayload(payload), collectionKey]),
		],
	};
}
