import { and, eq, inArray, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

type RedirectsResponse = {
	destination: string | null;
};

async function getCachedRedirectsNote(
	configRevision: string,
	redirectTags: readonly string[],
	config: LibraryServerConfig,
) {
	"use cache";
	cacheLife({ revalidate: 300 });
	cacheTag("redirects-note");
	if (!redirectTags.length) return null;
	const db = await getDatabaseForConfig(config);

	return db.query.item.findFirst({
		where: and(
			sql`exists (
				select 1 from ${itemToTag}
				where ${itemToTag.itemKey} = ${item.key}
					and ${inArray(itemToTag.tagName, [...redirectTags])}
			)`,
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
	const config = await getLibraryConfig();
	if (!config.generation.redirects) {
		return NextResponse.json<RedirectsResponse>(
			{ destination: null },
			{
				headers: {
					"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
				},
			},
		);
	}

	const note = await getCachedRedirectsNote(
		config.revision,
		config.content.tags.redirects,
		config,
	);
	const destination = note?.note
		? parseRedirects(note.note).get(requestedPath) ?? null
		: null;

	return NextResponse.json<RedirectsResponse>(
		{ destination },
		{
			headers: {
				"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
			},
		}
	);
}
