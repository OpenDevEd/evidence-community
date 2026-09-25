export async function readBoundedResponse(
	response: Response,
	maxBytes: number,
	inactivityTimeoutMs: number,
	totalTimeoutMs: number,
	error: (message: string, status?: number) => Error = (message) =>
		new Error(message),
) {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel();
		throw error(
			`Source response is ${contentLength} bytes, exceeding the ${maxBytes}-byte limit`,
			413,
		);
	}
	if (!response.body) {
		throw error("Source response had no body");
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = Date.now() + totalTimeoutMs;
	try {
		while (true) {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				throw error(
					"Source response download exceeded its total deadline",
				);
			}
			const read = reader.read();
			const result = await Promise.race([
				read,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() =>
							reject(
								error(
									remainingMs <= inactivityTimeoutMs
										? "Source response download exceeded its total deadline"
										: "Source response download timed out",
								),
							),
						Math.min(inactivityTimeoutMs, remainingMs),
					);
				}),
			]);
			if (timeout) clearTimeout(timeout);
			if (result.done) break;
			total += result.value.byteLength;
			if (total > maxBytes) {
				throw error(
					`Source response exceeds the ${maxBytes}-byte limit`,
					413,
				);
			}
			chunks.push(result.value);
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		if (timeout) clearTimeout(timeout);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
