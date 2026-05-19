import { and, arrayContains, eq } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { REDIRECTS_TAG } from "@/constants/items";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

type RedirectsResponse = {
	destination: string | null;
};

async function getCachedRedirectsNote() {
	"use cache";
	cacheLife({ revalidate: 300 });
	cacheTag("redirects-note");

	return db.query.item.findFirst({
		where: and(
			arrayContains(item.tags, [REDIRECTS_TAG]),
			eq(item.itemType, "Note"),
			eq(item.deleted, 0)
		),
		columns: {
			note: true,
		},
	});
}

function decodeHtmlEntities(value: string) {
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
		const namedEntities: Record<string, string> = {
			amp: "&",
			apos: "'",
			gt: ">",
			lt: "<",
			nbsp: " ",
			quot: '"',
		};

		const lowerEntity = String(entity).toLowerCase();
		if (lowerEntity in namedEntities) return namedEntities[lowerEntity];
		if (lowerEntity.startsWith("#x")) {
			return String.fromCodePoint(Number.parseInt(lowerEntity.slice(2), 16));
		}
		if (lowerEntity.startsWith("#")) {
			return String.fromCodePoint(Number.parseInt(lowerEntity.slice(1), 10));
		}

		return match;
	});
}

function noteHtmlToLines(html: string) {
	return decodeHtmlEntities(
		html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
			.replace(/<[^>]*>/g, "")
	)
		.split(/\r?\n/)
		.map((line) => line.trim());
}

function removeComment(line: string) {
	let result = "";
	let escaping = false;

	for (const character of line) {
		if (escaping) {
			result += character;
			escaping = false;
			continue;
		}

		if (character === "\\") {
			escaping = true;
			continue;
		}

		if (character === "#") break;
		result += character;
	}

	if (escaping) result += "\\";
	return result.trim();
}

function isDirectiveLine(line: string) {
	return /^\s*_*\%\%/.test(line);
}

function parseRedirects(noteHtml: string) {
	const redirects = new Map<string, string>();

	for (const rawLine of noteHtmlToLines(noteHtml)) {
		if (isDirectiveLine(rawLine)) continue;

		const line = removeComment(rawLine);
		if (!line) continue;

		const separatorIndex = line.indexOf("=");
		if (separatorIndex < 1) continue;

		const key = line.slice(0, separatorIndex).trim().replace(/^\/+|\/+$/g, "");
		const destination = line.slice(separatorIndex + 1).trim();

		if (key && destination) {
			redirects.set(key, destination);
		}
	}

	return redirects;
}

export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ path: string[] }> }
) {
	const params = await props.params;
	const requestedPath = params.path.join("/");
	const note = await getCachedRedirectsNote();
	const destination = note?.note
		? parseRedirects(note.note).get(requestedPath) ?? null
		: null;

	return NextResponse.json<RedirectsResponse>(
		{ destination },
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
			},
		}
	);
}
