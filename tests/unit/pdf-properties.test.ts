import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readPdfProperties, writePdfProperties, type PdfProperties } from "@/lib/admin/pdf-properties";

const EMPTY: PdfProperties = { authors: [], date: "", doi: "", isbn: "", issn: "", issue: "", keywords: [], language: "", pages: "", publicationTitle: "", publisher: "", rights: "", subject: "", title: "", volume: "" };

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
	subject: "Attendance rose in the schools that took part.",
	title: "Girls' learning in Sierra Leone",
	volume: "12",
};

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

	it("writes the date, publisher, language and journal details, and reads them back", async () => {
		const reading = await readPdfProperties(await writePdfProperties(await archivalPdf(), ARTICLE));
		expect(reading).toMatchObject({ properties: ARTICLE, writable: true });
	});

	// PDF/A accepts PRISM only when the file declares it in an extension schema.
	it("declares the journal details it writes for PDF/A", async () => {
		const text = new TextDecoder("latin1").decode(await writePdfProperties(await archivalPdf(), ARTICLE));
		expect(text).toContain("<pdfaSchema:namespaceURI>http://prismstandard.org/namespaces/basic/3.0/</pdfaSchema:namespaceURI>");
		for (const name of ["publicationName", "volume", "number", "pageRange", "issn"]) expect(text).toContain(`<pdfaProperty:name>${name}</pdfaProperty:name>`);
		expect(text).not.toContain("<pdfaProperty:name>isbn</pdfaProperty:name>");
	});

	it("adds the declaration to a file's own extension schemas rather than a second list", async () => {
		const own = XMP.replace("</r:RDF>", '<r:Description r:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"><pdfaExtension:schemas><r:Bag><r:li r:parseType="Resource"><pdfaSchema:prefix>own</pdfaSchema:prefix></r:li></r:Bag></pdfaExtension:schemas></r:Description></r:RDF>');
		const document = await PDFDocument.create();
		document.addPage();
		document.catalog.set(PDFName.of("Metadata"), document.context.register(document.context.stream(own, { Type: "Metadata", Subtype: "XML" })));
		const text = new TextDecoder("latin1").decode(await writePdfProperties(await document.save(), ARTICLE));
		expect(text.match(/<pdfaExtension:schemas>/g)).toHaveLength(1);
		expect(text).toContain("<pdfaSchema:prefix>own</pdfaSchema:prefix>");
		expect(text).toContain("<pdfaSchema:prefix>prism</pdfaSchema:prefix>");
	});

	it("leaves out a date or language a record holds as free text, which XMP can't take", async () => {
		const reading = await readPdfProperties(await writePdfProperties(await archivalPdf(), { ...ARTICLE, date: "Spring 2026", language: "English" }));
		expect(reading).toMatchObject({ properties: { date: "", language: "", title: ARTICLE.title } });
	});
});
