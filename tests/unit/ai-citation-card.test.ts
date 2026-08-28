import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn(async () => true) }));

import {
	citationNames,
	citedAttachment,
} from "@/components/features/markdown/Citation";

import type { Item, ItemGetResponse } from "@/app/api/item/types";

const attachment = (fields: Partial<Item>) => fields as Item;

const readable = attachment({
	key: "PDF00001",
	filename: "teacher-training.pdf",
	title: "Teacher training report",
	PDFCoverPageImage: "cover.png",
});

const item = (
	attachments: Item[],
	fields: Partial<Item> = {},
): ItemGetResponse["item"] =>
	({
		key: "ABCD1234",
		title: "<i>Teaching</i> by radio",
		fullNames: ["Ada Lovelace", "Grace Hopper"],
		attachmentsData: attachments,
		...fields,
	}) as ItemGetResponse["item"];

describe("which file a citation points at", () => {
	it("uses the attachment the citation names", () => {
		const other = attachment({
			...readable,
			key: "PDF00002",
			filename: "other.pdf",
		});

		expect(citedAttachment(item([readable, other]), "PDF00002")).toBe(
			other,
		);
	});

	it("falls back to the only readable PDF when the key is stale", () => {
		expect(citedAttachment(item([readable]), "GONE0001")).toBe(readable);
	});

	it("refuses to guess when a publication has several PDFs", () => {
		const other = attachment({ ...readable, key: "PDF00002" });

		expect(
			citedAttachment(item([readable, other]), "GONE0001"),
		).toBeUndefined();
	});

	it("has nothing to fall back to when no PDF is readable", () => {
		expect(
			citedAttachment(
				item([attachment({ key: "PDF00003", filename: "hidden.pdf" })]),
				"GONE0001",
			),
		).toBeUndefined();
	});
});

describe("what a citation card is called", () => {
	it("names the file and its publication in plain text", () => {
		expect(
			citationNames({
				attachment: readable,
				attachmentKey: "PDF00001",
				documentLabel: "Document",
				item: item([readable]),
			}),
		).toEqual({
			attachmentName: "teacher-training.pdf",
			documentName: "Teacher training report",
			title: "Teaching by radio",
			authors: "Ada Lovelace, Grace Hopper",
		});
	});

	it("falls back to the key and a plain label when nothing is named", () => {
		expect(
			citationNames({
				attachment: undefined,
				attachmentKey: "PDF00009",
				documentLabel: "Document",
				item: undefined,
			}),
		).toEqual({
			attachmentName: "PDF00009.pdf",
			documentName: "Document",
			title: "-",
			authors: "",
		});
	});

	it("shortens a long author list", () => {
		const many = item([readable], {
			fullNames: ["One", "Two", "Three", "Four"],
		});

		expect(
			citationNames({
				attachment: readable,
				attachmentKey: "PDF00001",
				documentLabel: "Document",
				item: many,
			}).authors,
		).toBe("One, Two, Three et al.");
	});
});
