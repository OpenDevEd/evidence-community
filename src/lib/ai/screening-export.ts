import { escapeHtml } from "@/lib/escape-html";

export type ScreeningFieldValue = string | number | boolean | null;

export type ScreeningResultsData = {
	result: Record<
		string,
		{
			title: string;
			screeningFields: Record<string, ScreeningFieldValue>;
		}
	>;
	fields: Array<{
		label: string;
		type: "string" | "number" | "boolean";
	}>;
};

export type ScreeningExportContent = {
	plaintext: string;
	markdown: string;
	html: string;
	csv: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isScreeningResultsData(
	value: unknown,
): value is ScreeningResultsData {
	if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.fields)) {
		return false;
	}

	if (
		!value.fields.every(
			(field) =>
				isRecord(field) &&
				typeof field.label === "string" &&
				["string", "number", "boolean"].includes(String(field.type)),
		)
	) {
		return false;
	}

	return Object.values(value.result).every(
		(result) =>
			isRecord(result) &&
			typeof result.title === "string" &&
			isRecord(result.screeningFields),
	);
}

function valueText(value: ScreeningFieldValue) {
	return value === null ? "" : String(value);
}


function markdownCell(value: string) {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("|", "\\|")
		.replaceAll(/\r?\n/g, "<br>");
}

function markdownLinkLabel(value: string) {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("[", "\\[")
		.replaceAll("]", "\\]");
}

function csvCell(value: string) {
	const formulaSafeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${formulaSafeValue.replaceAll('"', '""')}"`;
}

function publicationUrl(resourceId: string, origin?: string) {
	const path = `/lib/${resourceId}`;
	return origin ? new URL(path, origin).toString() : path;
}

export function screeningExportContent(
	results: ScreeningResultsData,
	origin?: string,
): ScreeningExportContent {
	const fields = results.fields;
	const headers = [
		"Title",
		"Evidence Library key",
		"Evidence Library URL",
		...fields.map(({ label, type }) => `${label} (${type})`),
	];
	const rows = Object.entries(results.result).map(([resourceId, result]) => {
		const url = publicationUrl(resourceId, origin);
		return {
			resourceId,
			title: result.title,
			url,
			values: fields.map(({ label }) =>
				valueText(result.screeningFields[label] ?? null),
			),
		};
	});

	const plaintext = [
		"Smart Screening Results",
		...rows.flatMap((row) => [
			"",
			row.title,
			`Key: ${row.resourceId}`,
			`URL: ${row.url}`,
			...fields.map(
				(field, index) =>
					`${field.label} (${field.type}): ${row.values[index]}`,
			),
		]),
	].join("\n");

	const markdown = [
		"# Smart Screening Results",
		"",
		`| ${headers.map(markdownCell).join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map(
			(row) =>
				`| ${[
					`[${markdownLinkLabel(row.title)}](${row.url})`,
					row.resourceId,
					row.url,
					...row.values,
				]
					.map(markdownCell)
					.join(" | ")} |`,
		),
	].join("\n");

	const html = [
		"<section>",
		"<h1>Smart Screening Results</h1>",
		"<table>",
		`<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
		"<tbody>",
		...rows.map(
			(row) =>
				`<tr><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.title)}</a></td>${[
					row.resourceId,
					row.url,
					...row.values,
				]
					.map((value) => `<td>${escapeHtml(value)}</td>`)
					.join("")}</tr>`,
		),
		"</tbody>",
		"</table>",
		"</section>",
	].join("\n");

	const csv = [
		headers.map(csvCell).join(","),
		...rows.map((row) =>
			[row.title, row.resourceId, row.url, ...row.values]
				.map(csvCell)
				.join(","),
		),
	].join("\r\n");

	return { plaintext, markdown, html, csv };
}
