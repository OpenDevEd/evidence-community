"use client";

import Image from "next/image";
import { useState, type ComponentProps } from "react";

/** Where a file sits in a library's public storage, from its public address. */
const PUBLIC_STORAGE = /^https?:\/\/[^/?#]+\/storage\/v1\/object\/public\/[^/?#]+\/([^?#]+)/u;

/**
 * A publication's cover, sized for where it is shown. Covers are stored as full first pages (1600 px wide), so one
 * from the library's public storage goes through `/covers` and Next's optimizer; any other address, or a cover the
 * optimizer cannot serve, loads as it is.
 */
export function CoverImage({ src, alt, ...props }: Omit<ComponentProps<typeof Image>, "src"> & { src: string }) {
	const [direct, setDirect] = useState(false);
	const path = direct ? undefined : PUBLIC_STORAGE.exec(src)?.[1];
	if (!path) return <Image {...props} src={src} alt={alt} unoptimized />;
	return <Image {...props} src={`/covers/${path}`} alt={alt} onError={() => setDirect(true)} />;
}
