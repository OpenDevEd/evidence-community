"use client";

import { useState, type Ref } from "react";
import { CoverImage } from "./CoverImage";
import { Skeleton } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";

// Covers already shown at a size on this page load. The item page draws its cover again when the full record
// replaces the quick first render, and a cover the browser already holds should not flash its placeholder.
const shownCovers = new Set<string>();

/**
 * A publication's first page, as the library extracted it from its PDF; an accent block stands in when there is none.
 * `sizes` is how wide it is drawn (a publication page's by default). A cover always drawn at one `width` in CSS pixels
 * says so instead: its image then offers two copies, for normal and sharp screens, rather than every size there is.
 */
export function PdfCover({ src, alt, ref, onLoad, className, sizes = "(min-width: 640px) 208px, 330px", width }: { src?: string | null; alt: string; ref?: Ref<HTMLImageElement>; onLoad?: () => void; className?: string; sizes?: string; width?: number }) {
	const shown = `${src}|${width ?? sizes}`;
	const [loaded, setLoaded] = useState(() => shownCovers.has(shown));
	if (!src) return <div className={twMerge("aspect-[3/4] w-full rounded-xl bg-accent", className)} />;
	return (
		<Skeleton isLoaded={loaded} className="w-full rounded-xl">
			<CoverImage
				ref={ref}
				src={src}
				alt={alt}
				width={width ?? 512}
				height={width ?? 512}
				sizes={width ? undefined : sizes}
				onLoad={() => {
					shownCovers.add(shown);
					setLoaded(true);
					onLoad?.();
				}}
				className={twMerge("w-full rounded-xl bg-accent", className)}
			/>
		</Skeleton>
	);
}
