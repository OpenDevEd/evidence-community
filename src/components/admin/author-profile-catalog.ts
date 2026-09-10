import {
	parseAuthorCatalog,
	parseAuthorPage,
	type AuthorPageRequest,
} from "@/lib/authors/profiles";

async function requestAuthorProfiles(body: object): Promise<unknown> {
	const response = await fetch("/api/admin/author-profiles", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const result = await response.json();
	if (!response.ok)
		throw new Error(
			typeof result.error === "string"
				? result.error
				: (result.error?.message ?? "Unable to load author profiles"),
		);
	return result;
}

export async function loadAuthorPage({ search, cursor }: AuthorPageRequest) {
	return parseAuthorPage(
		await requestAuthorProfiles({
			operation: "search",
			search,
			paginationOpts: { cursor, numItems: 12 },
		}),
	);
}

export async function createAuthorProfile(name: string) {
	const result = parseAuthorCatalog(
		await requestAuthorProfiles({ operation: "create", name }),
	);
	const profile = result.profiles[0];
	if (!profile) throw new Error("The new author profile was not returned.");
	return profile;
}
