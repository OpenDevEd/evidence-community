"use client";

import { useState, type Ref } from "react";
import { CoverImage } from "./CoverImage";
import { Skeleton } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";

/**
 * A publication's first page, as the library extracted it from its PDF; an accent block stands in when there is none.
 * `sizes` is how wide it is drawn (a publication page's by default). A cover always drawn at one `width` in CSS pixels
 * says so instead: its image then offers two copies, for normal and sharp screens, rather than every size there is.
 */
export function PdfCover({ src, alt, ref, onLoad, className, sizes = "(min-width: 640px) 208px, 330px", width }: { src?: string | null; alt: string; ref?: Ref<HTMLImageElement>; onLoad?: () => void; className?: string; sizes?: string; width?: number }) {
	const [loaded, setLoaded] = useState(false);
	// A cover the browser already holds appears as it is; only a cover still arriving fades in.
	const [heldAlready, setHeldAlready] = useState(false);
	if (!src) return <div className={twMerge("aspect-[3/4] w-full rounded-xl bg-accent", className)} />;
	return (
		<Skeleton isLoaded={loaded} disableAnimation={heldAlready} className="w-full rounded-xl">
			<CoverImage
				ref={(element) => {
					// A cover the browser already holds, for example when the item page draws it again after its quick first
					// render, is complete as soon as it is attached: show it before the first paint instead of the placeholder.
					if (element?.complete && element.naturalWidth > 0) {
						setHeldAlready(true);
						setLoaded(true);
					}
					if (typeof ref === "function") ref(element);
					else if (ref) ref.current = element;
				}}
				src={src}
				alt={alt}
				width={width ?? 512}
				height={width ?? 512}
				sizes={width ? undefined : sizes}
				onLoad={() => {
					setLoaded(true);
					onLoad?.();
				}}
				className={twMerge("w-full rounded-xl bg-accent", className)}
			/>
		</Skeleton>
	);
}
