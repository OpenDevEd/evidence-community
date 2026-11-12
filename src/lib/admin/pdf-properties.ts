import { decodePDFRawStream, EncryptedPDFError, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { create } from "xmlbuilder2";

import { languageTag } from "@/lib/languages";
import { xmpDate, type PdfProperties } from "./pdf-record-mapping";

/**
 * What a PDF claims to meet: tags for screen readers, and the PDF/A and
 * PDF/UA parts its XMP block declares ("2B", "1"). Empty when it claims none.
 * These are the file's own claims; nothing here validates them.
 */
export type PdfStandards = { pdfa: string; pdfua: string; tagged: boolean };

/** Publishing can only write into a PDF that opens without a password and parses. */
export type PdfPropertiesReading = { properties: PdfProperties; standards: PdfStandards; writable: true } | { reason: "damaged" | "password"; writable: false };

const METADATA = PDFName.of("Metadata");

const NS = {
	dc: "http://purl.org/dc/elements/1.1/",
	pdf: "http://ns.adobe.com/pdf/1.3/",
	pdfaExtension: "http://www.aiim.org/pdfa/ns/extension/",
	pdfaid: "http://www.aiim.org/pdfa/ns/id/",
	pdfaProperty: "http://www.aiim.org/pdfa/ns/property#",
	pdfaSchema: "http://www.aiim.org/pdfa/ns/schema#",
	pdfuaid: "http://www.aiim.org/pdfua/ns/id/",
	prism: "http://prismstandard.org/namespaces/basic/3.0/",
	rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	xmp: "http://ns.adobe.com/xap/1.0/",
	xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
} as const;

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// XML can't hold most control characters, so a value that carries one would make the block unreadable.
const xmlSafe = (text: string) => text.replace(/[\0-\x08\x0B\x0C\x0E-\x1F\u{D800}-\u{DFFF}\u{FFFE}\u{FFFF}]/gu, "");

function xmpOf(document: PDFDocument) {
	const stream = document.catalog.lookup(METADATA);
	return stream instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(stream).decode()) : "";
}

/** The XMP block parsed with its namespaces, so a property is found by what it is, whatever prefix the file binds; null when it doesn't parse. */
function parseXmp(xmp: string) {
	if (!xmp.trim()) return null;
	try {
		return create(xmp);
	} catch {
		return null;
	}
}

type XmpBlock = NonNullable<ReturnType<typeof parseXmp>>;
// xmlbuilder2 implements the standard DOM under its own types.
const documentOf = (block: XmpBlock) => block.node as unknown as Document;

const elementsIn = (root: Node, ns: string, local: string) => [...(root as Element).getElementsByTagNameNS(ns, local)];
const childElements = (parent: Node) => [...parent.childNodes].filter((node): node is Element => node.nodeType === 1);
const isProperty = (element: Element, ns: string, local: string) => element.namespaceURI === ns && element.localName === local;
const descriptions = (block: XmpBlock) => elementsIn(documentOf(block), NS.rdf, "Description");

/** Every value of one property: an attribute of a description, or an element holding text or a list. */
function xmpValues(block: XmpBlock | null, ns: string, local: string) {
	for (const description of block ? descriptions(block) : []) {
		const attribute = description.getAttributeNS(ns, local)?.trim();
		if (attribute) return [attribute];
		for (const property of childElements(description).filter((child) => isProperty(child, ns, local))) {
			const items = elementsIn(property, NS.rdf, "li").map((item) => item.textContent?.trim() ?? "").filter(Boolean);
			if (items.length) return items;
			const text = property.textContent?.trim();
			if (text) return [text];
		}
	}
	return [];
}

const xmpText = (block: XmpBlock | null, ns: string, local: string) => xmpValues(block, ns, local)[0] ?? "";

/** The PDF/A part and level the file declares ("2B"). Parts 1 to 3 need both; PDF/A-4 has no required level. */
function pdfaOf(block: XmpBlock | null) {
	const part = xmpText(block, NS.pdfaid, "part");
	const level = xmpText(block, NS.pdfaid, "conformance").toUpperCase();
	return part && (level || Number(part) >= 4) ? part + level : "";
}

/** The DOI publishing wrote as `dc:identifier`, or one another tool wrote as `prism:doi`. */
function doiOf(block: XmpBlock | null) {
	const identifier = xmpText(block, NS.dc, "identifier").replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
	return xmpText(block, NS.prism, "doi") || (identifier.startsWith("10.") ? identifier : "");
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
	const block = parseXmp(safely(() => xmpOf(document), ""));
	const author = safely(() => document.getAuthor()?.trim() ?? "", "");
	const keywords = safely(() => document.getKeywords()?.trim() ?? "", "");
	const list = (ns: string, local: string) => xmpValues(block, ns, local);
	return {
		writable: true,
		properties: {
			authors: list(NS.dc, "creator").length ? list(NS.dc, "creator") : author ? [author] : [],
			date: list(NS.dc, "date")[0] ?? "",
			doi: doiOf(block),
			isbn: xmpText(block, NS.prism, "isbn"),
			issn: xmpText(block, NS.prism, "issn"),
			issue: xmpText(block, NS.prism, "number"),
			keywords: list(NS.dc, "subject").length ? list(NS.dc, "subject") : keywords.split(/[;,]/).map((word) => word.trim()).filter(Boolean),
			language: list(NS.dc, "language")[0] ?? "",
			pages: xmpText(block, NS.prism, "pageRange"),
			publicationTitle: xmpText(block, NS.prism, "publicationName"),
			publisher: list(NS.dc, "publisher")[0] ?? "",
			rights: list(NS.dc, "rights")[0] ?? "",
			seriesNumber: xmpText(block, NS.prism, "seriesNumber"),
			seriesTitle: xmpText(block, NS.prism, "seriesTitle"),
			subject: safely(() => document.getSubject()?.trim() ?? "", "") || (list(NS.dc, "description")[0] ?? ""),
			title: safely(() => document.getTitle()?.trim() ?? "", "") || (list(NS.dc, "title")[0] ?? ""),
			volume: xmpText(block, NS.prism, "volume"),
		},
		standards: { pdfa: pdfaOf(block), pdfua: xmpText(block, NS.pdfuaid, "part"), tagged: safely(() => taggedOf(document), false) },
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
 * The XMP properties publishing owns, by namespace and name. The file keeps
 * every other one, such as its PDF/A and PDF/UA claims, creation date and
 * creator tool. A rights-marked flag the file had goes too: whether the new
 * rights mean copyrighted isn't known.
 */
const WRITTEN: [string, string][] = [
	...["creator", "date", "description", "identifier", "language", "publisher", "rights", "subject", "title"].map((local): [string, string] => [NS.dc, local]),
	[NS.pdf, "Keywords"],
	...["doi", "isbn", "issn", "number", "pageRange", "publicationName", "seriesNumber", "seriesTitle", "volume"].map((local): [string, string] => [NS.prism, local]),
	[NS.xmp, "MetadataDate"],
	[NS.xmp, "ModifyDate"],
	[NS.xmpRights, "Marked"],
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

const EXTENSION_NAMESPACES = `xmlns:pdfaExtension="${NS.pdfaExtension}" xmlns:pdfaSchema="${NS.pdfaSchema}" xmlns:pdfaProperty="${NS.pdfaProperty}"`;

/**
 * The PDF/A extension schema entry that declares the PRISM properties.
 * PDF/A accepts a property outside its predefined schemas only when the
 * file declares it like this. It declares all of them, so a later write
 * with more of them filled is covered too.
 */
function prismSchemaEntry() {
	const properties = PRISM_PROPERTIES.map(({ description, name }) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${name}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${description}</pdfaProperty:description></rdf:li>`)
		.join("");
	return `<rdf:li rdf:parseType="Resource" xmlns:rdf="${NS.rdf}" ${EXTENSION_NAMESPACES}><pdfaSchema:schema>PRISM Basic Metadata</pdfaSchema:schema><pdfaSchema:namespaceURI>${NS.prism}</pdfaSchema:namespaceURI><pdfaSchema:prefix>prism</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${properties}</rdf:Seq></pdfaSchema:property></rdf:li>`;
}

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
		`<rdf:Description rdf:about="" xmlns:rdf="${NS.rdf}" xmlns:dc="${NS.dc}" xmlns:pdf="${NS.pdf}" xmlns:prism="${NS.prism}" xmlns:xmp="${NS.xmp}" ${EXTENSION_NAMESPACES}>`,
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
		text("pdf:Keywords", properties.keywords.join(", ")),
		text("xmp:ModifyDate", date),
		text("xmp:MetadataDate", date),
		schemas ? `<pdfaExtension:schemas><rdf:Bag>${schemas}</rdf:Bag></pdfaExtension:schemas>` : "",
		"</rdf:Description>",
	].join("");
}

/** A fragment of XMP as an element of this block, ready to add to it. */
const elementFor = (block: XmpBlock, xml: string) => documentOf(block).importNode(documentOf(create(xml)).documentElement, true);

/**
 * The file's own list of extension schemas and, when it declares PRISM, the
 * PRISM properties that entry names. PDF/A allows one list, so a file's own
 * takes PRISM's declaration; one that can't take it (no list of entries)
 * leaves a PDF/A file without PRISM.
 */
function extensionSchemas(block: XmpBlock) {
	const lists = elementsIn(documentOf(block), NS.pdfaExtension, "schemas");
	const bag = lists.flatMap(childElements).find((element) => isProperty(element, NS.rdf, "Bag"));
	const prismEntry = bag && childElements(bag).find((entry) => elementsIn(entry, NS.pdfaSchema, "namespaceURI").some((uri) => uri.textContent?.trim() === NS.prism));
	return { bag, declared: prismEntry ? new Set(elementsIn(prismEntry, NS.pdfaProperty, "name").map((name) => name.textContent?.trim() ?? "")) : null, hasList: lists.length > 0 };
}

/** Removes the properties publishing owns from every description in the block. */
function withoutWritten(block: XmpBlock) {
	for (const description of descriptions(block)) {
		for (const [ns, local] of WRITTEN) {
			description.removeAttributeNS(ns, local);
			for (const child of childElements(description)) if (isProperty(child, ns, local)) description.removeChild(child);
		}
	}
}

/**
 * The PRISM properties the block can take, and the list of extension schemas
 * to write when the file has none. A file that declares PRISM itself takes,
 * when it is PDF/A, only the properties it names; otherwise the declaration
 * joins the file's list, or a new one when it has none. A PDF/A file with a
 * list that can't take it gets no PRISM.
 */
function prismFor(block: XmpBlock, prism: { name: string; value: string }[]) {
	const { bag, declared, hasList } = extensionSchemas(block);
	const archival = Boolean(pdfaOf(block));
	if (declared) return { ownList: "", written: archival ? prism.filter(({ name }) => declared.has(name)) : prism };
	if (!prism.length) return { ownList: "", written: prism };
	if (bag) bag.appendChild(elementFor(block, prismSchemaEntry()));
	else if (!hasList) return { ownList: prismSchemaEntry(), written: prism };
	return { ownList: "", written: bag || !archival ? prism : [] };
}

/** The file's XMP block with the record written over the properties publishing owns, or a new block when it has none or it doesn't parse. */
function mergedXmp(existing: string, properties: PdfProperties, date: string) {
	const prism = prismValues(properties);
	const block = parseXmp(existing);
	const rdf = block && elementsIn(documentOf(block), NS.rdf, "RDF")[0];
	if (!block || !rdf) return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${NS.rdf}">${recordDescription(properties, date, prism, prism.length ? prismSchemaEntry() : "")}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
	withoutWritten(block);
	const { ownList, written } = prismFor(block, prism);
	rdf.appendChild(elementFor(block, recordDescription(properties, date, written, ownList)));
	return block.end({ headless: true, prettyPrint: false });
}

/** The record with every value XML can hold, so the document properties and the XMP block stay equal. */
const safeProperties = (properties: PdfProperties): PdfProperties =>
	Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, Array.isArray(value) ? value.map(xmlSafe) : xmlSafe(value)])) as PdfProperties;

/**
 * Writes a record into a PDF: the document properties every viewer shows,
 * and the same values in its XMP block with the rights and DOI, which have
 * no document property. The pages and everything else the file says about
 * itself are untouched, so a PDF/A or PDF/UA file stays one.
 */
export async function writePdfProperties(bytes: Uint8Array, record: PdfProperties) {
	const properties = safeProperties(record);
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
	const authors = xmpText(parseXmp(existing), NS.pdfaid, "part") === "1" && properties.authors.length > 1 ? [properties.authors.join("; ")] : properties.authors;
	const xmp = new TextEncoder().encode(mergedXmp(existing, { ...properties, authors }, date.toISOString().replace(".000Z", "Z")));
	const stream = document.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
	const current = document.catalog.get(METADATA);
	if (current instanceof PDFRef) document.context.assign(current, stream);
	else document.catalog.set(METADATA, document.context.register(stream));
	return document.save({ useObjectStreams: usesObjectStreams(bytes) });
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/**
 * Whether the file keeps its cross-reference in a stream, alone or beside a
 * table, as a file that packs objects into streams must. Saving keeps the
 * file's own choice: plain tables everywhere would grow such files by up to
 * half, and PDF/A-1 forbids streams. It reads the section `startxref` points
 * at and that section's trailer, never text elsewhere in the file, which a
 * record's abstract could fill with anything.
 */
function usesObjectStreams(bytes: Uint8Array) {
	const offset = Number(/startxref\s+(\d+)\s*%%EOF\s*$/.exec(latin1(bytes.subarray(Math.max(0, bytes.length - 1024))))?.[1]);
	if (!Number.isInteger(offset) || offset >= bytes.length) return false;
	const section = latin1(bytes.subarray(offset));
	if (/^\s*\d+\s+\d+\s+obj\b/.test(section)) return true;
	return /\/XRefStm\b/.test(/trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(section)?.[1] ?? "");
}
