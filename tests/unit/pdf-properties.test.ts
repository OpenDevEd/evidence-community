import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readPdfProperties, writePdfProperties } from "@/lib/admin/pdf-properties";
import { pdfPropertiesOfRecord, type PdfProperties } from "@/lib/admin/pdf-record-mapping";

const EMPTY: PdfProperties = { authors: [], date: "", doi: "", isbn: "", issn: "", issue: "", keywords: [], language: "", pages: "", publicationTitle: "", publisher: "", rights: "", seriesNumber: "", seriesTitle: "", subject: "", title: "", volume: "" };

const ARTICLE: PdfProperties = {
	...EMPTY,
	authors: ["Amara Kamara", "Ben Osei"],
	date: "2026-03",
	doi: "10.5072/zenodo.1234567",
	issn: "1049-4820",
	issue: "3",
	keywords: ["School attendance", "girls' education"],
	language: "en",
	pages: "45-67",
	publicationTitle: "Journal of Education in Africa",
	publisher: "Taylor & Francis",
	rights: "© Crown copyright 2026",
	seriesNumber: "7",
	seriesTitle: "Education Research Reports",
	subject: "Attendance rose in the schools that took part.",
	title: "Girls' learning in Sierra Leone",
	volume: "12",
};

const pdfWithXmp = async (xmp: string) => {
	const document = await PDFDocument.create();
	document.addPage();
	document.catalog.set(PDFName.of("Metadata"), document.context.register(document.context.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
	return document.save();
};
const textOf = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// Prefixes are the file's choice: this block binds RDF to "r" and Dublin Core to "purl".
const XMP = [
	'<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
	'<x:xmpmeta xmlns:x="adobe:ns:meta/"><r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
	'<r:Description r:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/>',
	'<r:Description r:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></r:Description>',
	'<r:Description r:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:ModifyDate="2020-01-01T00:00:00Z"><xmp:CreatorTool>LibreOffice Writer</xmp:CreatorTool></r:Description>',
	'<r:Description r:about="" xmlns:purl="http://purl.org/dc/elements/1.1/"><purl:title><r:Alt><r:li xml:lang="x-default">Draft title</r:li></r:Alt></purl:title></r:Description>',
	"</r:RDF></x:xmpmeta>",
	'<?xpacket end="w"?>',
].join("");

/** A tagged PDF/A-2b and PDF/UA-1 file with its claims and creation details in its XMP block. */
async function archivalPdf() {
	const document = await PDFDocument.create();
	document.addPage();
	document.catalog.set(PDFName.of("MarkInfo"), document.context.obj({ Marked: true }));
	document.catalog.set(PDFName.of("StructTreeRoot"), document.context.register(document.context.obj({ Type: "StructTreeRoot" })));
	document.catalog.set(PDFName.of("Metadata"), document.context.register(document.context.stream(XMP, { Type: "Metadata", Subtype: "XML" })));
	return document.save();
}

describe("writing a record into a PDF", () => {
	it("keeps what the file says about itself and replaces only the record's properties", async () => {
		const written = await writePdfProperties(await archivalPdf(), { ...EMPTY, authors: ["Amara Kamara"], doi: "10.5072/zenodo.1234567", keywords: ["School attendance"], rights: "© Crown copyright 2026", subject: "Attendance rose in the schools that took part.", title: "Girls' learning in Sierra Leone" });
		expect(await readPdfProperties(written)).toMatchObject({
			properties: { doi: "10.5072/zenodo.1234567", rights: "© Crown copyright 2026", title: "Girls' learning in Sierra Leone" },
			standards: { pdfa: "2B", pdfua: "1", tagged: true },
			writable: true,
		});
		const text = new TextDecoder("latin1").decode(written);
		expect(text).toContain("LibreOffice Writer");
		expect(text).not.toContain("Draft title");
		expect(text).not.toContain("2020-01-01T00:00:00Z");
	});

	// PDF/A-1 forbids cross-reference streams, and a written file may be written again.
	it("keeps a file's plain cross-reference table, whatever its header says", async () => {
		const document = await PDFDocument.create();
		document.addPage();
		const properties = { ...EMPTY, title: "A report" };
		const written = await writePdfProperties(await document.save({ useObjectStreams: false }), properties);
		expect(new TextDecoder("latin1").decode(written)).not.toMatch(/\/Type\s*\/XRef/);
	});

	// A file whose text happens to name a cross-reference stream still has a plain table.
	it("keeps the file's own kind of cross-reference, read from its structure and not its text", async () => {
		const plain = await PDFDocument.create();
		plain.addPage();
		plain.catalog.set(PDFName.of("Note"), PDFString.of("/Type /ObjStm /XRefStm"));
		expect(textOf(await writePdfProperties(await plain.save({ useObjectStreams: false }), { ...EMPTY, title: "A report" }))).not.toMatch(/\/Type\s*\/XRef\b/);
		const packed = await PDFDocument.create();
		packed.addPage();
		expect(textOf(await writePdfProperties(await packed.save({ useObjectStreams: true }), { ...EMPTY, title: "A report" }))).toMatch(/\/Type\s*\/XRef\b/);
	});

	// Prefixes are only names: a property is publishing's by its namespace.
	it("keeps a file's properties that share a prefix with publishing's but mean something else", async () => {
		const own = XMP.replace("</r:RDF>", '<r:Description r:about="" xmlns:dc="http://example.org/catalogue/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/"><dc:title>Shelf mark 12</dc:title><prism:volume>Old volume</prism:volume></r:Description></r:RDF>');
		const text = textOf(await writePdfProperties(await pdfWithXmp(own), ARTICLE));
		expect(text).toContain("Shelf mark 12");
		expect(text).toContain("Old volume");
		expect(text).not.toContain("Draft title");
	});

	// Most control characters can't appear in XML at all; one in a title would leave the block unreadable.
	it("drops characters XML can't hold, so the block still reads", async () => {
		const reading = await readPdfProperties(await writePdfProperties(await archivalPdf(), { ...ARTICLE, authors: ["Amara\u0007 Kamara"], title: "Girls'\u0001 learning\uFFFE in Sierra Leone" }));
		expect(reading).toMatchObject({ properties: { authors: ["Amara Kamara"], doi: ARTICLE.doi, title: "Girls' learning in Sierra Leone" }, standards: { pdfa: "2B" } });
	});

	it("writes the date, publisher, language, journal and series details, and reads them back", async () => {
		const reading = await readPdfProperties(await writePdfProperties(await archivalPdf(), ARTICLE));
		expect(reading).toMatchObject({ properties: ARTICLE, writable: true });
	});

	// PDF/A accepts PRISM only when the file declares it in an extension schema, once.
	it("declares every journal and series property for PDF/A, so writing again with more filled stays valid", async () => {
		const first = await writePdfProperties(await archivalPdf(), { ...EMPTY, publicationTitle: ARTICLE.publicationTitle, title: ARTICLE.title });
		const second = await writePdfProperties(first, ARTICLE);
		const text = textOf(second);
		expect(text.match(/<pdfaSchema:prefix>prism<\/pdfaSchema:prefix>/g)).toHaveLength(1);
		for (const name of ["publicationName", "volume", "number", "pageRange", "issn", "isbn", "seriesTitle", "seriesNumber"]) expect(text).toContain(`<pdfaProperty:name>${name}</pdfaProperty:name>`);
		expect(await readPdfProperties(second)).toMatchObject({ properties: ARTICLE });
	});

	it("adds the declaration to a file's own extension schemas rather than a second list, comments and all", async () => {
		const own = XMP.replace("</r:RDF>", '<r:Description r:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"><pdfaExtension:schemas><r:Bag><r:li r:parseType="Resource"><pdfaSchema:prefix>own</pdfaSchema:prefix></r:li></r:Bag> <!-- schemas end --> </pdfaExtension:schemas></r:Description></r:RDF>');
		const text = textOf(await writePdfProperties(await pdfWithXmp(own), ARTICLE));
		expect(text.match(/<pdfaExtension:schemas>/g)).toHaveLength(1);
		expect(text).toContain("<pdfaSchema:prefix>own</pdfaSchema:prefix>");
		expect(text).toContain("<pdfaSchema:prefix>prism</pdfaSchema:prefix>");
	});

	// Another schema's property of the same name isn't a PRISM declaration.
	it("writes only the PRISM properties a PDF/A file declares when it declares PRISM itself", async () => {
		const own = XMP.replace("</r:RDF>", '<r:Description r:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><r:Bag><r:li r:parseType="Resource"><pdfaSchema:namespaceURI>http://example.org/own/</pdfaSchema:namespaceURI><pdfaSchema:property><r:Seq><r:li r:parseType="Resource"><pdfaProperty:name>issn</pdfaProperty:name></r:li></r:Seq></pdfaSchema:property></r:li><r:li r:parseType="Resource"><pdfaSchema:namespaceURI>http://prismstandard.org/namespaces/basic/3.0/</pdfaSchema:namespaceURI><pdfaSchema:prefix>prism</pdfaSchema:prefix><pdfaSchema:property><r:Seq><r:li r:parseType="Resource"><pdfaProperty:name>volume</pdfaProperty:name></r:li></r:Seq></pdfaSchema:property></r:li></r:Bag></pdfaExtension:schemas></r:Description></r:RDF>');
		const reading = await readPdfProperties(await writePdfProperties(await pdfWithXmp(own), ARTICLE));
		expect(reading).toMatchObject({ properties: { ...ARTICLE, isbn: "", issn: "", issue: "", pages: "", publicationTitle: "", seriesNumber: "", seriesTitle: "" } });
	});

	it("leaves out a date or language XMP can't take, and writes a named language as its code", async () => {
		const named = await readPdfProperties(await writePdfProperties(await archivalPdf(), { ...ARTICLE, language: "English" }));
		expect(named).toMatchObject({ properties: { language: "en" } });
		for (const [date, language] of [["Spring 2026", "Klingonese"], ["2026-02-30", "en GB"], ["2026-13", ""]] as const) {
			const reading = await readPdfProperties(await writePdfProperties(await archivalPdf(), { ...ARTICLE, date, language }));
			expect(reading).toMatchObject({ properties: { date: "", language: "", title: ARTICLE.title } });
		}
	});
});

describe("the PDF properties of a record", () => {
	// The review shows these before publishing writes them, so both must agree.
	it("hold only what publishing writes, the series included", () => {
		const report = { date: "2026-02-30", itemType: "report", languageName: "English", publisher: "FCDO", seriesNumber: "12", seriesTitle: "K4D Helpdesk Report", tags: ["girls"], title: "A report" };
		expect(pdfPropertiesOfRecord(report, { authors: [], doi: "", keywords: ["Education"] })).toMatchObject({ date: "", keywords: ["Education", "girls"], language: "en", publisher: "FCDO", seriesNumber: "12", seriesTitle: "K4D Helpdesk Report" });
		expect(pdfPropertiesOfRecord({ itemType: "book", languageName: "en-GB", series: "Studies in Education" }, { authors: [], doi: "", keywords: [] })).toMatchObject({ language: "en-GB", seriesTitle: "Studies in Education" });
		// dc:identifier reads "doi:" and the DOI; one stored as an address would be written as neither.
		expect(pdfPropertiesOfRecord({ DOI: "https://doi.org/10.5072/ABC" }, { authors: [], doi: "", keywords: [] }).doi).toBe("10.5072/abc");
	});

	// Records hold a language as free text, often its name; XMP takes only a tag.
	it("write a language the record names as its code, and leave out one it can't name", () => {
		const language = (languageName: string) => pdfPropertiesOfRecord({ languageName }, { authors: [], doi: "", keywords: [] }).language;
		expect(["Swahili", "portuguese", "Hebrew", "Cebuano", "Klingonese"].map(language)).toEqual(["sw", "pt", "he", "ceb", ""]);
	});
});
