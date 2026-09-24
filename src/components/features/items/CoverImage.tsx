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
	const stored = direct ? null : PUBLIC_STORAGE.exec(src);
	if (!stored) return <Image {...props} src={src} alt={alt} unoptimized />;
	const [, host, bucket, path] = stored;
	return <Image {...props} src={`/covers/${host}/${bucket}/${path}`} alt={alt} onError={() => setDirect(true)} />;
}
