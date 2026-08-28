import { describe, expect, it } from "vitest";

import {
	hasBylineDetails,
	hasPreviewDetails,
	publicationPreviewData,
} from "@/components/features/items/PublicationHoverPreview";

const formatter = {
	dateTime: (value: Date) =>
		value.toISOString().slice(0, 10).split("-").reverse().join("/"),
} as never;

const options = {
	contentTags: { comingSoon: ["_comingsoon"], internal: ["internal"] },
	etAl: "et al.",
	formatter,
	institutions: [
		{ id: "edtech", name: "EdTech Hub", logoUrl: "logo.png" },
	],
} as never;

describe("what a publication preview says", () => {
	it("reads title and abstract as plain text", () => {
		const preview = publicationPreviewData(
			{
				title: "<i>Teaching</i> by radio",
				abstractNote: "<p>Radio &amp; learning</p>",
			},
			options,
		);

		expect(preview.title).toBe("Teaching by radio");
		expect(preview.abstract).toBe("Radio & learning");
	});

	it("names up to two authors and shortens longer lists", () => {
		const twoAuthors = publicationPreviewData(
			{
				creators: [
					{ lastName: "Lovelace", firstName: "Ada" },
					{ lastName: "Hopper", firstName: "Grace" },
				],
			},
			options,
		);
		const manyAuthors = publicationPreviewData(
			{
				creators: [
					{ lastName: "Lovelace", firstName: "Ada" },
					{ lastName: "Hopper", firstName: "Grace" },
					{ lastName: "Turing", firstName: "Alan" },
				],
			},
			options,
		);

		expect(twoAuthors.authors).toBe("Lovelace, A. & Hopper, G.");
		expect(manyAuthors.authors).toBe("Lovelace, A. et al.");
	});

	it("marks the library's own coming-soon and internal records", () => {
		const preview = publicationPreviewData(
			{ tags: ["_comingsoon", "internal"] },
			options,
		);

		expect(preview.isComingSoon).toBe(true);
		expect(preview.isInternal).toBe(true);
	});

	it("shows the publisher's logo when the library configured one", () => {
		const preview = publicationPreviewData(
			{ institution: ["EdTech Hub"] },
			options,
		);

		expect(preview.institution?.logoUrl).toBe("logo.png");
	});

	it("keeps a date it cannot parse instead of dropping it", () => {
		expect(
			publicationPreviewData({ date: "n.d." }, options).fullDate,
		).toBe("n.d.");
		expect(
			publicationPreviewData({ date: "2024-03-01" }, options).fullDate,
		).toBe("01/03/2024");
	});

	it("knows when there is nothing worth previewing", () => {
		const empty = publicationPreviewData({}, options);

		expect(hasPreviewDetails(empty)).toBe(false);
		expect(hasBylineDetails(empty)).toBe(false);
		expect(
			hasPreviewDetails(
				publicationPreviewData({ abstractNote: "Something" }, options),
			),
		).toBe(true);
	});
});
