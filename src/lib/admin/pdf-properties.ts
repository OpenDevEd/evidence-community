import { decodePDFRawStream, EncryptedPDFError, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

import { parseBibliographicDate } from "@/lib/bibliographic-date";

/** What a PDF says about itself in its document properties and XMP block. Empty when unset. */
export type PdfProperties = {
	authors: string[];
	/** Publication date: a year, a month or a day, as XMP dates are written. */
	date: string;
	doi: string;
	isbn: string;
	issn: string;
	issue: string;
	keywords: string[];
	/** A language tag such as "en". */
	language: string;
	pages: string;
	/** The journal, book, proceedings or website it appeared in. */
	publicationTitle: string;
	publisher: string;
	rights: string;
	seriesNumber: string;
	seriesTitle: string;
	subject: string;
	title: string;
	volume: string;
};

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// XMP dates and language tags have set forms; a record's value is only written when it has them.
const xmpDate = (value: string) => (parseBibliographicDate(value).kind === "parsed" ? value : "");

const codesByName = new Map<number, Map<string, string>>();
/** Language codes of one length by their English names: "swahili" to "sw", "cebuano" to "ceb". */
function languageCodes(length: 2 | 3) {
	const known = codesByName.get(length);
	if (known) return known;
	const names = new Intl.DisplayNames(["en"], { fallback: "none", type: "language" });
	const letters = [..."abcdefghijklmnopqrstuvwxyz"];
	const codes = length === 2 ? letters.flatMap((first) => letters.map((second) => first + second)) : letters.flatMap((first) => letters.flatMap((second) => letters.map((third) => first + second + third)));
	const found = new Map(codes.flatMap((code) => {
		const name = names.of(code);
		// A retired code names the same language as its successor: "iw" is "he".
		return name ? [[name.toLowerCase(), Intl.getCanonicalLocales(code)[0]!] as const] : [];
	}));
	codesByName.set(length, found);
	return found;
}

/**
 * A record's language as XMP writes it: the tag it holds ("en-GB"), or the
 * code of the language it names ("English"); otherwise none. Tags prefer
 * two-letter codes, and the three-letter list takes a moment to build, so
 * it is read only for a name the two-letter one doesn't have.
 */
const languageTag = (value: string) => (!value || /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) ? value : (languageCodes(2).get(value.toLowerCase()) ?? languageCodes(3).get(value.toLowerCase()) ?? ""));

/**
 * What a published PDF carries in its own metadata: the record as the
 * library has it, its authors, and keywords (topic names and tags) and DOI
 * as the caller knows them. The review's preview and publishing both use it.
 */
export function pdfPropertiesOfRecord(payload: Record<string, unknown>, { authors, doi, keywords }: { authors: string[]; doi: string; keywords: string[] }): PdfProperties {
	const tags = Array.isArray(payload.tags) ? payload.tags.map(textOf).filter(Boolean) : [];
	return {
		authors,
		date: xmpDate(textOf(payload.date)),
		doi: textOf(payload.DOI) || doi,
		isbn: textOf(payload.ISBN),
		issn: textOf(payload.ISSN),
		issue: textOf(payload.issue),
		keywords: [...new Set([...keywords, ...tags])],
		language: languageTag(textOf(payload.languageName)),
		pages: textOf(payload.pages),
		publicationTitle: textOf(payload.publicationTitle),
		publisher: textOf(payload.publisher),
		rights: textOf(payload.rights),
		seriesNumber: textOf(payload.seriesNumber),
		seriesTitle: textOf(payload.seriesTitle) || textOf(payload.series),
		subject: textOf(payload.abstractNote),
		title: textOf(payload.title),
		volume: textOf(payload.volume),
	};
}

/**
 * What a PDF claims to meet: tags for screen readers, and the PDF/A and
 * PDF/UA parts its XMP block declares ("2B", "1"). Empty when it claims none.
 * These are the file's own claims; nothing here validates them.
 */
export type PdfStandards = { pdfa: string; pdfua: string; tagged: boolean };

/** Publishing can only write into a PDF that opens without a password and parses. */
export type PdfPropertiesReading = { properties: PdfProperties; standards: PdfStandards; writable: true } | { reason: "damaged" | "password"; writable: false };

const METADATA = PDFName.of("Metadata");

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function xmpOf(document: PDFDocument) {
	const stream = document.catalog.lookup(METADATA);
	return stream instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(stream).decode()) : "";
}

const NAMESPACES: Record<string, string> = {
	dc: "http://purl.org/dc/elements/1.1/",
	pdf: "http://ns.adobe.com/pdf/1.3/",
	pdfaid: "http://www.aiim.org/pdfa/ns/id/",
	pdfuaid: "http://www.aiim.org/pdfua/ns/id/",
	prism: "http://prismstandard.org/namespaces/basic/3.0/",
	xmp: "http://ns.adobe.com/xap/1.0/",
	xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
};

// ponytail: resolves prefixes from the block's xmlns declarations rather than
// parsing XML, so one prefix bound to two namespaces in different elements
// would confuse it; parse the XML with namespaces if that turns up.
/** Every name a property goes by in this XMP block: its usual prefix, and any other prefix the block binds to the same namespace. */
function namesOf(xmp: string, property: string) {
	const [prefix, local] = property.split(":") as [string, string];
	const bound = [...xmp.matchAll(/xmlns:([\w.-]+)=["']([^"']+)["']/g)].filter((match) => match[2] === NAMESPACES[prefix]).map((match) => match[1]!);
	return [...new Set([prefix, ...bound])].map((name) => `${name}:${local}`);
}

/** The list entries of one XMP property, such as every `dc:creator`. */
function xmpList(xmp: string, property: string) {
	for (const name of namesOf(xmp, property)) {
		const block = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xmp)?.[1];
		if (block) return [...block.matchAll(/<(?:[\w.-]+:)?li\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?li>/g)].map((match) => unescapeXml(match[1]!.trim())).filter(Boolean);
	}
	return [];
}

/** A simple XMP value, written as an element or as an attribute of its description. */
function xmpText(xmp: string, property: string) {
	for (const name of namesOf(xmp, property)) {
		const value = (new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xmp) ?? new RegExp(`\\s${name}=["']([^"']*)["']`).exec(xmp))?.[1]?.trim();
		if (value) return unescapeXml(value);
	}
	return "";
}

/** The PDF/A part and level the file declares ("2B"). Parts 1 to 3 need both; PDF/A-4 has no required level. */
function pdfaOf(xmp: string) {
	const part = xmpText(xmp, "pdfaid:part");
	const level = xmpText(xmp, "pdfaid:conformance").toUpperCase();
	return part && (level || Number(part) >= 4) ? part + level : "";
}

/** The DOI publishing wrote as `dc:identifier`, or one another tool wrote as `prism:doi`. */
function doiOf(xmp: string) {
	const identifier = xmpText(xmp, "dc:identifier").replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
	return xmpText(xmp, "prism:doi") || (identifier.startsWith("10.") ? identifier : "");
}

/** Marked as tagged, with a structure tree for screen readers to follow. */
function taggedOf(document: PDFDocument) {
	const marked = document.catalog.lookupMaybe(PDFName.of("MarkInfo"), PDFDict)?.lookup(PDFName.of("Marked"));
	return marked instanceof PDFBool && marked.asBoolean() && document.catalog.has(PDFName.of("StructTreeRoot"));
}

/** Reads the properties a PDF carries now and the standards it claims. */
export async function readPdfProperties(bytes: Uint8Array): Promise<PdfPropertiesReading> {
	let document: PDFDocument;
	try {
		document = await PDFDocument.load(bytes, { updateMetadata: false });
	} catch (error) {
		return { reason: error instanceof EncryptedPDFError ? "password" : "damaged", writable: false };
	}
	// A broken XMP block, Info value or catalog entry reads as unset; publishing replaces the properties anyway.
	const xmp = safely(() => xmpOf(document), "");
	const author = safely(() => document.getAuthor()?.trim() ?? "", "");
	const keywords = safely(() => document.getKeywords()?.trim() ?? "", "");
	return {
		writable: true,
		properties: {
			authors: xmpList(xmp, "dc:creator").length ? xmpList(xmp, "dc:creator") : author ? [author] : [],
			date: xmpList(xmp, "dc:date")[0] ?? "",
			doi: doiOf(xmp),
			isbn: xmpText(xmp, "prism:isbn"),
			issn: xmpText(xmp, "prism:issn"),
			issue: xmpText(xmp, "prism:number"),
			keywords: xmpList(xmp, "dc:subject").length ? xmpList(xmp, "dc:subject") : keywords.split(/[;,]/).map((word) => word.trim()).filter(Boolean),
			language: xmpList(xmp, "dc:language")[0] ?? "",
			pages: xmpText(xmp, "prism:pageRange"),
			publicationTitle: xmpText(xmp, "prism:publicationName"),
			publisher: xmpList(xmp, "dc:publisher")[0] ?? "",
			rights: xmpList(xmp, "dc:rights")[0] ?? "",
			seriesNumber: xmpText(xmp, "prism:seriesNumber"),
			seriesTitle: xmpText(xmp, "prism:seriesTitle"),
			subject: safely(() => document.getSubject()?.trim() ?? "", "") || (xmpList(xmp, "dc:description")[0] ?? ""),
			title: safely(() => document.getTitle()?.trim() ?? "", "") || (xmpList(xmp, "dc:title")[0] ?? ""),
			volume: xmpText(xmp, "prism:volume"),
		},
		standards: { pdfa: pdfaOf(xmp), pdfua:xmpText(xmp, "pdfuaid:part"), tagged: safely(() => taggedOf(document), false) },
	};
}

function safely<T>(read: () => T, fallback: T) {
	try {
		return read();
	} catch {
		return fallback;
	}
}

/**
 * The XMP properties publishing owns. The file keeps every other one, such
 * as its PDF/A and PDF/UA claims, creation date and creator tool.
 */
const WRITTEN = [
	"dc:creator", "dc:date", "dc:description", "dc:identifier", "dc:language", "dc:publisher", "dc:rights", "dc:subject", "dc:title", "pdf:Keywords",
	"prism:doi", "prism:isbn", "prism:issn", "prism:number", "prism:pageRange", "prism:publicationName", "prism:seriesNumber", "prism:seriesTitle", "prism:volume",
	"xmp:MetadataDate", "xmp:ModifyDate", "xmpRights:Marked",
];

/** The PRISM properties publishing writes, each with what the record calls it and a description for the PDF/A extension schema. */
const PRISM_PROPERTIES = [
	{ description: "Name of the journal, book, proceedings or website", field: "publicationTitle", name: "publicationName" },
	{ description: "Volume of the publication", field: "volume", name: "volume" },
	{ description: "Issue of the publication", field: "issue", name: "number" },
	{ description: "Pages of the work in the publication", field: "pages", name: "pageRange" },
	{ description: "ISSN of the publication", field: "issn", name: "issn" },
	{ description: "ISBN of the publication", field: "isbn", name: "isbn" },
	{ description: "Title of the series", field: "seriesTitle", name: "seriesTitle" },
	{ description: "Number in the series", field: "seriesNumber", name: "seriesNumber" },
] as const;

const EXTENSION_NAMESPACES = 'xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"';

/**
 * The PDF/A extension schema entry that declares the PRISM properties.
 * PDF/A accepts a property outside its predefined schemas only when the
 * file declares it like this. It declares all of them, so a later write
 * with more of them filled is covered too.
 */
function prismSchemaEntry() {
	const properties = PRISM_PROPERTIES.map(({ description, name }) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`)
		.join("");
	// It declares its own prefixes: in a file's own list of schemas they may be bound to other names, or not at all.
	return `<rdf:li rdf:parseType="Resource" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ${EXTENSION_NAMESPACES}><pdfaSchema:schema>PRISM Basic Metadata</pdfaSchema:schema><pdfaSchema:namespaceURI>${NAMESPACES.prism}</pdfaSchema:namespaceURI><pdfaSchema:prefix>prism</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${properties}</rdf:Seq></pdfaSchema:property></rdf:li>`;
}


/** The XMP block without one property under any of its names, whether written as an element or as an attribute. */
const withoutProperty = (xmp: string, property: string) =>
	namesOf(xmp, property).reduce(
		(text, name) => text.replace(new RegExp(`<${name}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${name}>)`, "g"), "").replace(new RegExp(`\\s${name}=(?:"[^"]*"|'[^']*')`, "g"), ""),
		xmp,
	);

/** The PRISM properties with a value in this record, by their PRISM names. */
const prismValues = (properties: PdfProperties) => PRISM_PROPERTIES.filter(({ field }) => properties[field]).map(({ field, name }) => ({ name, value: properties[field] }));

/**
 * The record as one `rdf:Description`. Dublin Core holds what it can, which
 * PDF/A accepts as is; that is why the DOI goes in `dc:identifier`. The
 * journal details have no Dublin Core place, so they go in PRISM, and
 * `schemas` is the PDF/A extension schema entry declaring them when the
 * file has no extension schemas of its own to add it to.
 */
function recordDescription(properties: PdfProperties, date: string, prism: { name: string; value: string }[], schemas: string) {
	const alt = (name: string, value: string) => (value ? `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${name}>` : "");
	const list = (name: string, kind: "Bag" | "Seq", values: string[]) => (values.length ? `<${name}><rdf:${kind}>${values.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join("")}</rdf:${kind}></${name}>` : "");
	const text = (name: string, value: string) => (value ? `<${name}>${escapeXml(value)}</${name}>` : "");
	return [
		`<rdf:Description rdf:about="" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:prism="${NAMESPACES.prism}" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" ${EXTENSION_NAMESPACES}>`,
		alt("dc:title", properties.title),
		list("dc:creator", "Seq", properties.authors),
		alt("dc:description", properties.subject),
		list("dc:subject", "Bag", properties.keywords),
		alt("dc:rights", properties.rights),
		text("dc:identifier", properties.doi && `doi:${properties.doi}`),
		list("dc:date", "Seq", xmpDate(properties.date) ? [properties.date] : []),
		list("dc:publisher", "Bag", properties.publisher ? [properties.publisher] : []),
		list("dc:language", "Bag", languageTag(properties.language) ? [languageTag(properties.language)] : []),
		...prism.map(({ name, value }) => text(`prism:${name}`, value)),
		properties.rights ? "<xmpRights:Marked>True</xmpRights:Marked>" : "",
		text("pdf:Keywords", properties.keywords.join(", ")),
		text("xmp:ModifyDate", date),
		text("xmp:MetadataDate", date),
		schemas ? `<pdfaExtension:schemas><rdf:Bag>${schemas}</rdf:Bag></pdfaExtension:schemas>` : "",
		"</rdf:Description>",
	].join("");
}

/** Where a file's own list of extension schemas closes, under whatever prefixes it uses, comments allowed between. */
const SCHEMAS_CLOSE = /<\/(?:[\w.-]+:)?Bag>((?:\s|<!--[\s\S]*?-->)*)<\/[\w.-]+:schemas>/;
const HAS_SCHEMAS = /<[\w.-]+:schemas[\s/>]/;
/** The file already declares PRISM. */
const PRISM_DECLARED = /namespaceURI>\s*http:\/\/prismstandard\.org\/namespaces\/basic\/3\.0\/\s*</;

/**
 * Where a file's XMP block takes PRISM's declaration, and which PRISM
 * properties it can take. PDF/A allows one list of extension schemas, so a
 * file with its own gets the declaration added to it. A PDF/A file whose
 * list can't take it, or that declares PRISM itself, gets only the PRISM
 * properties it declares.
 */
function prismPlacement(kept: string, prism: ReturnType<typeof prismValues>) {
	const ownSchemas = HAS_SCHEMAS.test(kept);
	if (prism.length && !PRISM_DECLARED.test(kept) && (!ownSchemas || SCHEMAS_CLOSE.test(kept))) return { inOwnList: ownSchemas, inRecord: !ownSchemas, written: prism };
	// ponytail: a name declared under another schema counts; read the declarations by schema if that turns up.
	return { inOwnList: false, inRecord: false, written: pdfaOf(kept) ? prism.filter(({ name }) => new RegExp(`name>\\s*${name}\\s*</`).test(kept)) : prism };
}

/** The file's XMP block with the record written over the properties publishing owns, or a new block when it has none. */
function mergedXmp(existing: string, properties: PdfProperties, date: string) {
	const prism = prismValues(properties);
	// The RDF element closes as </rdf:RDF> or under whatever prefix the file binds RDF to.
	const close = /<\/(?:[\w.-]+:)?RDF>/;
	if (!close.test(existing)) return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${recordDescription(properties, date, prism, prism.length ? prismSchemaEntry() : "")}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
	const kept = WRITTEN.reduce(withoutProperty, existing);
	const placement = prismPlacement(kept, prism);
	const declared = placement.inOwnList ? kept.replace(SCHEMAS_CLOSE, (tag) => prismSchemaEntry() + tag) : kept;
	return declared.replace(close, (tag) => recordDescription(properties, date, placement.written, placement.inRecord ? prismSchemaEntry() : "") + tag);
}

/**
 * Writes a record into a PDF: the document properties every viewer shows,
 * and the same values in its XMP block with the rights and DOI, which have
 * no document property. The pages and everything else the file says about
 * itself are untouched, so a PDF/A or PDF/UA file stays one.
 */
export async function writePdfProperties(bytes: Uint8Array, properties: PdfProperties) {
	const document = await PDFDocument.load(bytes, { updateMetadata: false });
	// PDF/A wants each document property to match its XMP twin, so an empty value removes both.
	const info = (key: string, value: string, set: () => void) => (value ? set() : document.context.lookupMaybe(document.context.trailerInfo.Info, PDFDict)?.delete(PDFName.of(key)));
	const keywords = properties.keywords.join(", ");
	const date = new Date(Math.floor(Date.now() / 1000) * 1000);
	info("Title", properties.title, () => document.setTitle(properties.title, { showInWindowTitleBar: true }));
	info("Author", properties.authors.join("; "), () => document.setAuthor(properties.authors.join("; ")));
	info("Subject", properties.subject, () => document.setSubject(properties.subject));
	// pdf-lib joins keywords with spaces, which runs topic names together.
	info("Keywords", keywords, () => document.setKeywords([keywords]));
	document.setModificationDate(date);
	const existing = safely(() => xmpOf(document), "");
	// PDF/A-1 wants exactly one dc:creator entry, equal to the Author property.
	const authors = xmpText(existing, "pdfaid:part") === "1" && properties.authors.length > 1 ? [properties.authors.join("; ")] : properties.authors;
	const xmp = new TextEncoder().encode(mergedXmp(existing, { ...properties, authors }, date.toISOString().replace(".000Z", "Z")));
	const stream = document.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
	const current = document.catalog.get(METADATA);
	if (current instanceof PDFRef) document.context.assign(current, stream);
	else document.catalog.set(METADATA, document.context.register(stream));
	return document.save({ useObjectStreams: usesObjectStreams(bytes) });
}

/**
 * Whether the file already packs objects into streams, in any section,
 * hybrid ones included. Saving keeps the file's own choice: plain tables
 * everywhere would grow such files by up to half, and PDF/A-1 forbids
 * streams. pdf-lib always writes a 1.7 header, so the header can't tell.
 * Stream dictionaries are never compressed, so their types show in the bytes.
 */
const usesObjectStreams = (bytes: Uint8Array) => /\/Type\s*\/(?:ObjStm|XRef)\b|\/XRefStm\b/.test(new TextDecoder("latin1").decode(bytes));
