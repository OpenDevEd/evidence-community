import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { readPdfProperties, writePdfProperties } from "@/lib/admin/pdf-properties";

const XMP = [
	'<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
	'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
	'<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" pdfaid:part="2" pdfaid:conformance="B"/>',
	'<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/"><pdfuaid:part>1</pdfuaid:part></rdf:Description>',
	'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:ModifyDate="2020-01-01T00:00:00Z"><xmp:CreatorTool>LibreOffice Writer</xmp:CreatorTool></rdf:Description>',
	'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Draft title</rdf:li></rdf:Alt></dc:title></rdf:Description>',
	"</rdf:RDF></x:xmpmeta>",
	'<?xpacket end="w"?>',
].join("");

/** A tagged PDF/A-2b and PDF/UA-1 file, its claims and creation details in its XMP block as LibreOffice writes them. */
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
		const written = await writePdfProperties(await archivalPdf(), {
			authors: ["Amara Kamara"],
			doi: "10.5072/zenodo.1234567",
			keywords: ["School attendance"],
			rights: "© Crown copyright 2026",
			subject: "Attendance rose in the schools that took part.",
			title: "Girls' learning in Sierra Leone",
		});
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
});
