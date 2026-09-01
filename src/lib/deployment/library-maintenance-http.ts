import { createServer, type Server } from "node:http";

const page = `<!doctype html>
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
		response.writeHead(503, {
			"Cache-Control": "no-store",
			"Content-Length": Buffer.byteLength(page).toString(),
			"Content-Type": "text/html; charset=utf-8",
			"Retry-After": "30",
			"X-Robots-Tag": "noindex, nofollow",
		});
		response.end(request.method === "HEAD" ? undefined : page);
	});
}
