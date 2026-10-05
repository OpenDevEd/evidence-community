export function saveDownload(blob: Blob, filename: string) {
	const objectUrl = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(objectUrl);
}

export class DownloadError extends Error {
	constructor(readonly code: string | undefined, readonly status: number) {
		super(`Download failed: ${status}`);
	}
}

export async function downloadFile(
	url: string,
	filename: string,
	init?: RequestInit,
) {
	const response = await fetch(url, init);
	if (!response.ok) {
		const error = await response.json().catch(() => null);
		throw new DownloadError(error?.code, response.status);
	}
	const blob = await response.blob();
	init?.signal?.throwIfAborted();
	saveDownload(blob, filename);
}
