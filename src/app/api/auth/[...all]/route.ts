import { toNextJsHandler } from "better-auth/next-js";

import { getReaderAuth } from "@/lib/readers/instance";

async function handle(request: Request) {
	const { auth } = await getReaderAuth();
	return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(handle);
