import { toNextJsHandler } from "better-auth/next-js";

import { getReaderAuth } from "@/lib/readers/auth";

async function handle(request: Request) {
	const { auth } = await getReaderAuth();
	return auth.handler(request);
}

export const { GET, POST } = toNextJsHandler(handle);
