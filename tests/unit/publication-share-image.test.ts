import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { renderPublicationShareImage } from "@/lib/publication-share-image";

afterEach(() => vi.restoreAllMocks());

it.each([
 "التعلم والتعليم — सीखना और शिक्षा — 学习与教育 — Éducation, atenção, współpraca",
 "A practical framework for inclusive classrooms, feedback and collaborative learning. ".repeat(4),
 '<span foreground="red">A title with literal markup & an ampersand</span>',
])("renders a bounded image without downloading fonts: %s", async (title) => {
 const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in image rendering"));
 const image = await renderPublicationShareImage(title, "Learning Engineering", "learning-engineering.openscholar.ai");
 expect(await sharp(image).metadata()).toMatchObject({format: "png", width: 1200, height: 630});
 expect(image.byteLength).toBeLessThan(300_000);
 expect(fetch).not.toHaveBeenCalled();
});
