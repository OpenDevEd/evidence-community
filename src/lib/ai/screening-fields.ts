import { z } from "zod";

import {
	SMART_SCREENING_FIELD_TYPES,
	type SmartScreeningField,
} from "@/types/ai";

/** Looks up wording, so these checks can speak the reader's language. */
export type ScreeningTranslate = (key: string) => string;

/** The shape one screening question has to have before it can be used. */
function screeningFieldSchema(
	t: ScreeningTranslate,
): z.ZodType<SmartScreeningField> {
	return z.object({
		label: z.string().min(1, t("labelRequired")).max(64, t("labelTooLong")),
		type: z.enum(SMART_SCREENING_FIELD_TYPES),
		description: z
			.string()
			.min(1, t("descriptionRequired"))
			.max(1024, t("descriptionTooLong")),
	});
}

/** Writes the questions out as plain text, one per line. */
export function screeningFieldsAsText(fields: SmartScreeningField[]): string {
	return fields
		.map(
			(field) =>
				`${field.label.trim()} (${field.type}): ${field.description.trim()}`,
		)
		.join("\n");
}

/** Reads that plain text back into questions, one per line. */
export function parseScreeningFieldLines(text: string): SmartScreeningField[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => {
			const [key, ...rest] = line.split(":");
			const [label, typeWithParentheses] = key?.split("(") ?? [];
			const [type] = typeWithParentheses?.split(")") ?? [];

			return {
				label: label?.trim() ?? "",
				type: type?.trim() as (typeof SMART_SCREENING_FIELD_TYPES)[number],
				description: rest.join(":").trim(),
			};
		});
}

/** Two questions cannot share a label, because answers are stored by label. */
function duplicateLabelErrors(
	fields: SmartScreeningField[],
	t: ScreeningTranslate,
): Record<number, string> {
	const seen: Record<string, number[]> = {};
	fields.forEach((field, index) => {
		const label = field.label.trim();
		if (!label) return;
		seen[label] = [...(seen[label] ?? []), index];
	});

	const errors: Record<number, string> = {};
	for (const [label, indices] of Object.entries(seen)) {
		if (indices.length < 2) continue;
		for (const index of indices) {
			errors[index] = `${t("fieldPrefix")} ${index + 1} ${label}: ${t(
				"duplicateLabelError",
			)}`;
		}
	}

	return errors;
}

/** Checks one question against the shape a screening run expects. */
function fieldShapeError(
	field: SmartScreeningField,
	index: number,
	schema: z.ZodType<SmartScreeningField>,
	t: ScreeningTranslate,
): string | undefined {
	const result = schema.safeParse(field);
	if (result.success) return undefined;
	const message = result.error.issues[0]?.message || t("invalidField");

	return `${t("fieldPrefix")} ${index + 1} ${field.label}: ${message}`;
}

/**
 * Checks every question the reader has written. The result is empty when they
 * are all ready to use; otherwise it holds one message per question at fault.
 */
export function screeningFieldErrors(
	fields: SmartScreeningField[],
	t: ScreeningTranslate,
): Record<number, string> {
	const schema = screeningFieldSchema(t);
	const errors = duplicateLabelErrors(fields, t);
	fields.forEach((field, index) => {
		if (errors[index]) return;
		const error = fieldShapeError(field, index, schema, t);
		if (error) errors[index] = error;
	});

	return errors;
}
