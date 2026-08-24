import { describe, expect, it } from "vitest";

import messages from "@/messages/en-US.json";
import {
	parseScreeningFieldLines,
	screeningFieldErrors,
	screeningFieldsAsText,
} from "@/lib/ai/screening-fields";
import type { SmartScreeningField } from "@/types/ai";

// The real wording readers see, so the messages below are the real messages.
const t = (key: string) =>
	(messages.ui as Record<string, string>)[key] ?? `missing:${key}`;

const country: SmartScreeningField = {
	label: "Country",
	type: "string",
	description: "Which country was the study run in?",
};

describe("checking the reader's screening questions", () => {
	it("accepts questions that are ready to use", () => {
		expect(screeningFieldErrors([country], t)).toEqual({});
	});

	it("rejects two questions with the same label", () => {
		const errors = screeningFieldErrors([country, { ...country }], t);

		expect(Object.keys(errors)).toEqual(["0", "1"]);
		expect(errors[0]).toContain("Duplicate label");
		expect(errors[1]).toContain("Country");
	});

	it("names the question that is missing its description", () => {
		const errors = screeningFieldErrors(
			[country, { ...country, label: "Sample size", description: "" }],
			t,
		);

		expect(errors[0]).toBeUndefined();
		expect(errors[1]).toBe("Field 2 Sample size: Description is required");
	});

	it("rejects a label that is too long to store", () => {
		const errors = screeningFieldErrors(
			[{ ...country, label: "L".repeat(65) }],
			t,
		);

		expect(errors[0]).toContain("less than 64 characters");
	});

	it("rejects an answer type the screening run cannot produce", () => {
		const errors = screeningFieldErrors(
			[{ ...country, type: "date" as SmartScreeningField["type"] }],
			t,
		);

		expect(errors[0]).toContain("Field 1 Country:");
	});
});

describe("editing the questions as plain text", () => {
	it("survives a round trip through the text tab", () => {
		const fields = [
			country,
			{
				label: "Sample size",
				type: "number" as const,
				description: "How many pupils took part?",
			},
		];

		expect(parseScreeningFieldLines(screeningFieldsAsText(fields))).toEqual(
			fields,
		);
	});

	it("keeps colons that belong to the description", () => {
		const [field] = parseScreeningFieldLines(
			"Aim (string): Compares two things: reading and writing",
		);

		expect(field).toEqual({
			label: "Aim",
			type: "string",
			description: "Compares two things: reading and writing",
		});
	});

	it("ignores blank lines", () => {
		expect(
			parseScreeningFieldLines("\n  \nCountry (string): Where?\n"),
		).toHaveLength(1);
	});
});
