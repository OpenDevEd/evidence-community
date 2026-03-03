import { NextRequest, NextResponse } from "next/server";
import { defaultParams, escapeXml, getExtraValues, parseCompanyName } from "@/lib/utils";
import { getItems } from "@/lib/actions";
import { create } from "xmlbuilder2";
import { getCachedStatus } from "../../cache";

function changeEveryValueInJSON(json: any) {
	for (const key in json) {
		if (typeof json[key] === "string") {
			json[key] = escapeXml(json[key]);
		} else if (typeof json[key] === "object") {
			changeEveryValueInJSON(json[key]);
		} else if (Array.isArray(json[key])) {
			json[key].forEach((item: any) => {
				changeEveryValueInJSON(item);
			});
		}
	}
}

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
	const params = await props.params;

	const { id } = params;

	const status = await getCachedStatus();
	const url = new URL(request.url);
	const queryParams = defaultParams(url.searchParams);
	const res = await getItems(queryParams, id === "main" ? undefined : id);

	changeEveryValueInJSON(res);

	const feed = create({
		version: "1.0",
		encoding: "UTF-8",
	}).ele("feed");

	// Add required Atom feed attributes
	feed.att("xmlns", "http://www.w3.org/2005/Atom");
	feed.att("xmlns:dc", "http://purl.org/dc/elements/1.1/");

	// Add feed metadata
	feed.ele("title").att("type", "html").txt("");

	const author = feed.ele("author");
	const { companyName } = parseCompanyName(status.companyName);
	author.ele("name").txt(escapeXml(companyName));
	author.ele("uri").txt(escapeXml(`${process.env.BASE_URL}/lib/`));

	// Add feed links
	feed.ele("link", {
		rel: "alternate",
		type: "text/html",
		href: escapeXml(
			`${url.origin}${url.pathname.replace("/atom.xml", "")}?${url.searchParams.toString()}`
		),
	});

	feed.ele("link", {
		rel: "self",
		type: "application/atom+xml",
		href: escapeXml(url.toString()),
	});

	if (res.currentPage < res.totalPages) {
		const nextUrl = new URL(url);
		nextUrl.searchParams.set(
			"page",
			String(Number(url.searchParams.get("page")) + 1)
		);
		feed.ele("link", {
			rel: "next",
			type: "application/atom+xml",
			href: escapeXml(nextUrl.toString()),
		});
	}

	if (res.currentPage > 1) {
		const prevUrl = new URL(url);
		prevUrl.searchParams.set(
			"page",
			String(Number(url.searchParams.get("page")) - 1)
		);
		feed.ele("link", {
			rel: "prev",
			type: "application/atom+xml",
			href: escapeXml(prevUrl.toString()),
		});
	}

	const lastUrl = new URL(url);
	lastUrl.searchParams.set("page", String(res.totalPages));
	feed.ele("link", {
		rel: "last",
		type: "application/atom+xml",
		href: escapeXml(lastUrl.toString()),
	});

    const firstUrl = new URL(url);
    firstUrl.searchParams.set("page", "1");
    feed.ele("link", {
        rel: "first",
        type: "application/atom+xml",
        href: escapeXml(firstUrl.toString()),
    });

	feed.ele("updated").txt(
		new Date(status.databaseUpdatedAt || new Date()).toISOString()
	);
	feed.ele("id").txt(escapeXml(url.toString()));
	feed.ele("generator")
		.att("uri", "https://github.com/OpenDevEd/new-el")
		.txt("new-el");

	// Add entries from res.items
	res.items.forEach((item) => {
		const entry = feed.ele("entry");
		const extraValues = getExtraValues(item.extra || "");
		entry
			.ele("title")
			.att("type", "html")
			.txt(item.title || "");
		entry.ele("link", {
			rel: "alternate",
			type: "text/html",
			href: escapeXml(`${process.env.BASE_URL}/lib/${item.key}`),
		});
		entry
			.ele("id")
			.txt(escapeXml(`${process.env.BASE_URL}/lib/${item.key}`));
		entry
			.ele("updated")
			.txt(
				new Date(
					item.dateModified ||
						item.dateAdded ||
						item.createdAt ||
						new Date()
				).toISOString()
			);
		entry
			.ele("published")
			.txt(
				new Date(
					item.dateAdded ||
						item.dateModified ||
						item.createdAt ||
						new Date()
				).toISOString()
			);
		item.creators?.forEach((creator: any) => {
			const names = { ...creator };
			delete names.creatorType;
			entry.ele("dc:creator").txt(Object.values(names).join(", "));
		});
		
		const date = [
			item.datePublished,
			item.date,
			item.dateDecided,
			item.dateEnacted,
			item.filingDate,
			item.issueDate,
		].find((date) => date);
		if (date) entry.ele("dc:date").txt(date);
		const doi = [item.DOI, extraValues.get("DOI")].find((doi) => doi);
		if (doi) entry.ele("dc:identifier").txt(doi);
		const ISBN = [item.ISBN, extraValues.get("ISBN")].find((ISBN) => ISBN);
		if (ISBN) entry.ele("dc:identifier").txt(ISBN);
		const ISSN = [item.ISSN, extraValues.get("ISSN")].find((ISSN) => ISSN);
		if (ISSN) entry.ele("dc:identifier").txt(ISSN);
		if (item.languageName) entry.ele("dc:language").txt(item.languageName);
		if (item.publisher) entry.ele("dc:publisher").txt(item.publisher);
		if (item.rights) entry.ele("dc:rights").txt(item.rights);
		entry.ele("dc:title").txt(item.title || "");
	});

	return new NextResponse(feed.end({ prettyPrint: true }), {
		headers: {
			"Content-Type": "application/atom+xml",
		},
	});
}
