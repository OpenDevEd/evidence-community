import { afterEach, describe, expect, it, vi } from "vitest";

import {
	institutionCountryInputSchema,
	searchOpenAlexInstitutions,
} from "@/lib/admin/institution-countries";

const json = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("searchOpenAlexInstitutions", () => {
	it("keeps the autocomplete order and drops a country the library cannot show", async () => {
		const fetcher = vi.fn(async (url: string) =>
			url.includes("/autocomplete/")
				? json({
						results: [
							{ id: "https://openalex.org/I2" },
							{ id: "https://openalex.org/I1" },
						],
					})
				: json({
						results: [
							{
								id: "https://openalex.org/I1",
								display_name: "University of Nairobi",
								country_code: "KE",
								geo: { city: "Nairobi", latitude: -1.28, longitude: 36.82 },
							},
							{
								id: "https://openalex.org/I2",
								display_name: "Somewhere",
								country_code: "ZZ",
								geo: null,
							},
						],
					}),
		);
		vi.stubGlobal("fetch", fetcher);

		expect(await searchOpenAlexInstitutions("nai")).toEqual([
			{ id: "I2", name: "Somewhere", countryCode: "", city: "", latitude: null, longitude: null },
			{
				id: "I1",
				name: "University of Nairobi",
				countryCode: "KE",
				city: "Nairobi",
				latitude: -1.28,
				longitude: 36.82,
			},
		]);
		expect(String(fetcher.mock.calls[1]?.[0])).toContain(
			"filter=openalex:I2|I1",
		);
	});

	it("does not ask for records when nothing matched", async () => {
		const fetcher = vi.fn(async () => json({ results: [] }));
		vi.stubGlobal("fetch", fetcher);

		expect(await searchOpenAlexInstitutions("zzzz")).toEqual([]);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});

describe("institutionCountryInputSchema", () => {
	it("accepts a known country and rejects an unknown one or a bad OpenAlex id", () => {
		expect(
			institutionCountryInputSchema.parse({
				name: " EdTech Hub ",
				countryCode: "GB",
			}),
		).toEqual({
			name: "EdTech Hub",
			countryCode: "GB",
			openalexId: null,
			city: null,
			latitude: null,
			longitude: null,
		});
		expect(
			institutionCountryInputSchema.safeParse({
				name: "EdTech Hub",
				countryCode: "ZZ",
			}).success,
		).toBe(false);
		expect(
			institutionCountryInputSchema.safeParse({
				name: "EdTech Hub",
				countryCode: "GB",
				openalexId: "https://openalex.org/I1",
			}).success,
		).toBe(false);
		expect(
			institutionCountryInputSchema.safeParse({
				name: "EdTech Hub",
				countryCode: "GB",
				openalexId: "I1",
				latitude: 51.5,
			}).success,
		).toBe(false);
		expect(
			institutionCountryInputSchema.safeParse({
				name: "EdTech Hub",
				countryCode: "GB",
				latitude: 51.5,
				longitude: -0.1,
			}).success,
		).toBe(false);
	});
});
