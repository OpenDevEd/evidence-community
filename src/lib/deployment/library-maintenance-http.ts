import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

const updatePage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Evidence Library update in progress</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { display: grid; min-height: 100vh; margin: 0; place-items: center; background: #f4f4ef; color: #162019; }
    main { width: min(36rem, calc(100% - 3rem)); }
    p { color: #59625b; font-size: 1.05rem; line-height: 1.65; }
    @media (prefers-color-scheme: dark) {
      body { background: #101512; color: #eef2ed; }
      p { color: #aeb8b0; }
    }
  </style>
</head>
<body>
  <main>
    <h1>This Evidence Library is being updated</h1>
    <p>The latest version will be available shortly. Please try again in a moment.</p>
  </main>
</body>
</html>
`;

// Released custom domains reach this path through the verifier's route file.
export const LIBRARY_RELEASED_PAGE_PATH = "/released";
const releasedPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Not found</title>
</head>
<body>
  <main>
    <h1>This address is not in use</h1>
  </main>
</body>
</html>
`;

function sendPage(
	request: IncomingMessage,
	response: ServerResponse,
	status: number,
	page: string,
	headers: Record<string, string> = {},
) {
	response.writeHead(status, {
		...headers,
		"Cache-Control": "no-store",
		"Content-Length": Buffer.byteLength(page).toString(),
		"Content-Type": "text/html; charset=utf-8",
		"X-Robots-Tag": "noindex, nofollow",
	});
	response.end(request.method === "HEAD" ? undefined : page);
}

export function createLibraryMaintenanceServer(): Server {
	return createServer((request, response) => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, {
				Allow: "GET, HEAD",
				"Cache-Control": "no-store",
				"Content-Length": "0",
			});
			response.end();
			return;
		}
		if (request.url?.split("?", 1)[0] === LIBRARY_RELEASED_PAGE_PATH) {
			sendPage(request, response, 404, releasedPage);
			return;
		}
		sendPage(request, response, 503, updatePage, { "Retry-After": "30" });
	});
}
