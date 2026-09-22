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

export async function downloadFile(
	url: string,
	filename: string,
	init?: RequestInit,
) {
	const response = await fetch(url, init);
	if (!response.ok) throw new Error(`Download failed: ${response.status}`);
	saveDownload(await response.blob(), filename);
}
