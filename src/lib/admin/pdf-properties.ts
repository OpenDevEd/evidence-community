import { decodePDFRawStream, EncryptedPDFError, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

/** What a PDF says about itself in its document properties and XMP block. Empty when unset. */
export type PdfProperties = {
	authors: string[];
	doi: string;
	keywords: string[];
	rights: string;
	subject: string;
	title: string;
};

/** Publishing can only write into a PDF that opens without a password and parses. */
export type PdfPropertiesReading = { properties: PdfProperties; writable: true } | { reason: "damaged" | "password"; writable: false };

const METADATA = PDFName.of("Metadata");

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function xmpOf(document: PDFDocument) {
	const stream = document.catalog.lookup(METADATA);
	return stream instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(stream).decode()) : "";
}

// ponytail: matches the usual dc/prism/xmpRights prefixes, not a custom prefix
// bound to the same namespace; parse the XML with namespaces if that turns up.
/** The `rdf:li` entries of one XMP property, such as every `dc:creator`. */
function xmpList(xmp: string, property: string) {
	const block = new RegExp(`<${property}(?:\\s[^>]*)?>([\\s\\S]*?)</${property}>`).exec(xmp)?.[1] ?? "";
	return [...block.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/g)].map((match) => unescapeXml(match[1]!.trim())).filter(Boolean);
}

/** A simple XMP value, written as an element or as an attribute of its description. */
const xmpText = (xmp: string, property: string) =>
	unescapeXml((new RegExp(`<${property}(?:\\s[^>]*)?>([^<]*)</${property}>`).exec(xmp) ?? new RegExp(`\\s${property}="([^"]*)"`).exec(xmp))?.[1]?.trim() ?? "");

/** Reads the properties a PDF carries now. */
export async function readPdfProperties(bytes: Uint8Array): Promise<PdfPropertiesReading> {
	let document: PDFDocument;
	try {
		document = await PDFDocument.load(bytes, { updateMetadata: false });
	} catch (error) {
		return { reason: error instanceof EncryptedPDFError ? "password" : "damaged", writable: false };
	}
	// A broken XMP block or Info value reads as unset; publishing replaces both anyway.
	const xmp = orEmpty(() => xmpOf(document));
	const author = orEmpty(() => document.getAuthor()?.trim());
	const keywords = orEmpty(() => document.getKeywords()?.trim());
	return {
		writable: true,
		properties: {
			authors: xmpList(xmp, "dc:creator").length ? xmpList(xmp, "dc:creator") : author ? [author] : [],
			doi: xmpText(xmp, "prism:doi"),
			keywords: xmpList(xmp, "dc:subject").length ? xmpList(xmp, "dc:subject") : keywords.split(/[;,]/).map((word) => word.trim()).filter(Boolean),
			rights: xmpList(xmp, "dc:rights")[0] ?? "",
			subject: orEmpty(() => document.getSubject()?.trim()) || (xmpList(xmp, "dc:description")[0] ?? ""),
			title: orEmpty(() => document.getTitle()?.trim()) || (xmpList(xmp, "dc:title")[0] ?? ""),
		},
	};
}

function orEmpty(read: () => string | undefined) {
	try {
		return read() ?? "";
	} catch {
		return "";
	}
}

function xmpPacket(properties: PdfProperties) {
	const alt = (name: string, value: string) => (value ? `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${name}>` : "");
	const list = (name: string, kind: "Bag" | "Seq", values: string[]) => (values.length ? `<${name}><rdf:${kind}>${values.map((value) => `<rdf:li>${escapeXml(value)}</rdf:li>`).join("")}</rdf:${kind}></${name}>` : "");
	const text = (name: string, value: string) => (value ? `<${name}>${escapeXml(value)}</${name}>` : "");
	return [
		'<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
		'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
		'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:prism="http://prismstandard.org/namespaces/basic/3.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">',
		alt("dc:title", properties.title),
		list("dc:creator", "Seq", properties.authors),
		alt("dc:description", properties.subject),
		list("dc:subject", "Bag", properties.keywords),
		alt("dc:rights", properties.rights),
		properties.rights ? "<xmpRights:Marked>True</xmpRights:Marked>" : "",
		text("pdf:Keywords", properties.keywords.join(", ")),
		text("prism:doi", properties.doi),
		"</rdf:Description></rdf:RDF></x:xmpmeta>",
		'<?xpacket end="w"?>',
	].join("");
}

/**
 * Writes a record into a PDF: the document properties every viewer shows,
 * and an XMP block for what they have no field for (rights and the DOI).
 * The pages are untouched.
 */
export async function writePdfProperties(bytes: Uint8Array, properties: PdfProperties) {
	const document = await PDFDocument.load(bytes, { updateMetadata: false });
	document.setTitle(properties.title, { showInWindowTitleBar: true });
	document.setAuthor(properties.authors.join("; "));
	document.setSubject(properties.subject);
	// pdf-lib joins keywords with spaces, which runs topic names together.
	document.setKeywords([properties.keywords.join(", ")]);
	document.setModificationDate(new Date());
	const stream = document.context.stream(new TextEncoder().encode(xmpPacket(properties)), { Type: "Metadata", Subtype: "XML" });
	document.catalog.set(METADATA, document.context.register(stream));
	return document.save();
}
