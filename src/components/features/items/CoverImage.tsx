"use client";

import Image from "next/image";
import { useState, type ComponentProps } from "react";

/** A file's storage host, bucket and place in it, from its public storage address. */
const PUBLIC_STORAGE = /^https?:\/\/([^/?#]+)\/storage\/v1\/object\/public\/([^/?#]+)\/([^?#]+)/u;

/**
 * A publication's cover, sized for where it is shown. Covers are stored as full first pages (1600 px wide), so one
 * from public storage goes through `/covers` and Next's optimizer, which only answers for the library's own storage;
 * any other address, or a cover the optimizer cannot serve, loads as it is.
 */
export function CoverImage({ src, alt, ...props }: Omit<ComponentProps<typeof Image>, "src"> & { src: string }) {
	const [direct, setDirect] = useState(false);
	const optimized = direct ? null : optimizedCover(src);
	if (!optimized) return <Image {...props} src={src} alt={alt} unoptimized />;
	return <Image {...props} src={optimized} alt={alt} onError={() => setDirect(true)} />;
}

/** Where Next's optimizer serves a cover from, when it can. */
export function optimizedCover(src: string) {
	const stored = PUBLIC_STORAGE.exec(src);
	if (!stored) return null;
	const [, host, bucket, path] = stored;
	return `/covers/${host}/${bucket}/${path}`;
}
