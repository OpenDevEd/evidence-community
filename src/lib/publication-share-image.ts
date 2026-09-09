import sharp from "sharp";
import { escapeHtml } from "@/lib/escape-html";

/** Render with Pango so complex scripts are shaped without runtime font downloads. */
export async function renderPublicationShareImage(title: string, libraryName: string, hostname: string) {
	const text = async (value: string, size: number, color: string, height: number) => {
		const options = {
			text: `<span foreground="${color}">${escapeHtml(value)}</span>`,
			font: `sans ${size}`, width: 1056, rgba: true, wrap: "word-char" as const,
		};
		const image = await sharp({ text: options }).png().toBuffer({ resolveWithObject: true });
		return image.info.height > height
			? sharp({ text: { ...options, height } }).png().toBuffer()
			: image.data;
	};
	const [heading, body, address] = await Promise.all([
		text(libraryName, 28, "#b5b5b5", 40),
		text(title, 56, "#f5f5f5", 330),
		text(hostname, 24, "#b5b5b5", 40),
	]);
	return sharp({ create: { width: 1200, height: 630, channels: 4, background: "#181818" } })
		.composite([{ input: heading, left: 72, top: 72 }, { input: body, left: 72, top: 158 }, { input: address, left: 72, top: 534 }])
		.png().toBuffer();
}
