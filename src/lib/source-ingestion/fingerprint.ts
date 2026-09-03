import { createHash } from "node:crypto";

import type {
	JsonValue,
	SourceCollectionUpsert,
	SourceItemUpsert,
} from "./batch-schema";

export function canonicalSourceJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalSourceJson).join(",")}]`;
	}
	return `{${Object.keys(value)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${canonicalSourceJson(value[key]!)}`,
		)
		.join(",")}}`;
}

export function sourcePayloadHash(payload: JsonValue) {
	return createHash("sha256")
		.update(canonicalSourceJson(payload))
		.digest("hex");
}

export function sourceItemFingerprint(record: SourceItemUpsert) {
	return sourcePayloadHash({
		aliases: record.aliases,
		citationMetric: record.citationMetric,
		collections: record.collections,
		file: record.file,
		metadata: record.metadata,
		parentSourceRecordKey: record.parentSourceRecordKey,
		raw: record.raw,
		referencedSourceRecordKeys: record.referencedSourceRecordKeys,
		sourceDates: record.sourceDates
			? {
					addedAt: record.sourceDates.addedAt?.toISOString() ?? null,
					modifiedAt:
						record.sourceDates.modifiedAt?.toISOString() ?? null,
				}
			: null,
	});
}

export function sourceCollectionFingerprint(record: SourceCollectionUpsert) {
	return sourcePayloadHash({
		data: record.data,
		parentSourceRecordKey: record.parentSourceRecordKey,
		raw: record.raw,
	});
}
