import { decodePDFRawStream, EncryptedPDFError, PDFBool, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

/** What a PDF says about itself in its document properties and XMP block. Empty when unset. */
export type PdfProperties = {
	authors: string[];
	doi: string;
	keywords: string[];
	rights: string;
	subject: string;
	title: string;
};

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
			doi: doiOf(xmp),
			keywords: xmpList(xmp, "dc:subject").length ? xmpList(xmp, "dc:subject") : keywords.split(/[;,]/).map((word) => word.trim()).filter(Boolean),
			rights: xmpList(xmp, "dc:rights")[0] ?? "",
			subject: safely(() => document.getSubject()?.trim() ?? "", "") || (xmpList(xmp, "dc:description")[0] ?? ""),
			title: safely(() => document.getTitle()?.trim() ?? "", "") || (xmpList(xmp, "dc:title")[0] ?? ""),
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
const WRITTEN = ["dc:creator", "dc:description", "dc:identifier", "dc:rights", "dc:subject", "dc:title", "pdf:Keywords", "prism:doi", "xmp:MetadataDate", "xmp:ModifyDate", "xmpRights:Marked"];

/** The XMP block without one property under any of its names, whether written as an element or as an attribute. */
const withoutProperty = (xmp: string, property: string) =>
	namesOf(xmp, property).reduce(
		(text, name) => text.replace(new RegExp(`<${name}(?:\\s[^>]*?)?(?:/>|>[\\s\\S]*?</${name}>)`, "g"), "").replace(new RegExp(`\\s${name}=(?:"[^"]*"|'[^']*')`, "g"), ""),
		xmp,
	);

/**
 * The record as one `rdf:Description`, in schemas PDF/A accepts without an
 * extension schema. That is why the DOI goes in `dc:identifier`, not `prism:doi`.
 */
function recordDescription(properties: PdfProperties, date: string) {
	const alt = (name: string, value: string) => (value ? `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${name}>` : "");
	const list = (name: string, kind: "Bag" | "Seq", values: string[]) => (values.length ? `<${name}><rdf:${kind}>${values.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join("")}</rdf:${kind}></${name}>` : "");
	const text = (name: string, value: string) => (value ? `<${name}>${escapeXml(value)}</${name}>` : "");
	return [
		'<rdf:Description rdf:about="" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">',
		alt("dc:title", properties.title),
		list("dc:creator", "Seq", properties.authors),
		alt("dc:description", properties.subject),
		list("dc:subject", "Bag", properties.keywords),
		alt("dc:rights", properties.rights),
		text("dc:identifier", properties.doi && `doi:${properties.doi}`),
		properties.rights ? "<xmpRights:Marked>True</xmpRights:Marked>" : "",
		text("pdf:Keywords", properties.keywords.join(", ")),
		text("xmp:ModifyDate", date),
		text("xmp:MetadataDate", date),
		"</rdf:Description>",
	].join("");
}

/** The file's XMP block with the record written over the properties publishing owns, or a new block when it has none. */
function mergedXmp(existing: string, properties: PdfProperties, date: string) {
	const description = recordDescription(properties, date);
	// The RDF element closes as </rdf:RDF> or under whatever prefix the file binds RDF to.
	const close = /<\/(?:[\w.-]+:)?RDF>/;
	if (close.test(existing)) return WRITTEN.reduce(withoutProperty, existing).replace(close, (tag) => description + tag);
	return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
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
