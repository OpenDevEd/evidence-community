import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";
import { expect, it } from "vitest";

import { processPdf } from "@/lib/admin/pdf-processing";

it("renders the cover as a PNG of the first page, colours included", async () => {
	const document = await PDFDocument.create();
	const page = document.addPage([612, 792]);
	// A red square in the top-left quarter; the rest of the page stays white.
	page.drawRectangle({ x: 0, y: 396, width: 306, height: 396, color: rgb(1, 0, 0) });
	const processed = await processPdf(new Uint8Array(await document.save()));

	const cover = sharp(processed.cover);
	expect(await cover.metadata()).toMatchObject({ format: "png", width: processed.coverWidth, height: processed.coverHeight });
	const { data, info } = await cover.raw().toBuffer({ resolveWithObject: true });
	const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
	expect(pixel(100, 100)).toEqual([255, 0, 0]);
	expect(pixel(info.width - 100, info.height - 100)).toEqual([255, 255, 255]);
});
