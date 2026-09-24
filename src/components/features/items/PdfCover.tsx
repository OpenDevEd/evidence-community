"use client";

import { useState, type Ref } from "react";
import { CoverImage } from "./CoverImage";
import { Skeleton } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";

/** A publication's first page, as the library extracted it from its PDF; an accent block stands in when there is none. `sizes` is how wide it is drawn (a publication page's by default). */
export function PdfCover({ src, alt, ref, onLoad, className, sizes = "(min-width: 640px) 208px, 330px" }: { src?: string | null; alt: string; ref?: Ref<HTMLImageElement>; onLoad?: () => void; className?: string; sizes?: string }) {
	const [loaded, setLoaded] = useState(false);
	if (!src) return <div className={twMerge("aspect-[3/4] w-full rounded-xl bg-accent", className)} />;
	return (
		<Skeleton isLoaded={loaded} className="w-full rounded-xl">
			<CoverImage
				ref={ref}
				src={src}
				alt={alt}
				width={512}
				height={512}
				sizes={sizes}
				onLoad={() => {
					setLoaded(true);
					onLoad?.();
				}}
				className={twMerge("w-full rounded-xl bg-accent", className)}
			/>
		</Skeleton>
	);
}
