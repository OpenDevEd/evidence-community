import { createHash } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4000);
const storageBytes = Buffer.from(
	"Evidence Library publication acceptance PDF\n",
);
const depositions = new Map();
let nextDepositionId = 7001;
let crossrefXml = null;
let crossrefDeposits = 0;

function json(response, status, body) {
	response.writeHead(status, { "Content-Type": "application/json" });
	response.end(JSON.stringify(body));
}

function text(response, status, body, contentType = "text/plain") {
	response.writeHead(status, { "Content-Type": contentType });
	response.end(body);
}

async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function depositionJson(deposition) {
	return {
		id: Number(deposition.id),
		record_id: Number(deposition.id),
		conceptrecid: Number(deposition.parentId),
		submitted: deposition.published,
		state: deposition.published ? "done" : "unsubmitted",
		metadata: deposition.metadata,
		links: {
			self: `https://sandbox.zenodo.org/api/deposit/depositions/${deposition.id}`,
			html: `https://sandbox.zenodo.org/deposit/${deposition.id}`,
			bucket: `https://sandbox.zenodo.org/api/files/bucket-${deposition.id}`,
		},
		files: [...deposition.files.entries()].map(
			([filename, bytes], index) => ({
				id: `file-${index + 1}`,
				filename,
				filesize: bytes.byteLength,
				checksum: `md5:${createHash("md5").update(bytes).digest("hex")}`,
			}),
		),
	};
}

function publishedRecord(deposition) {
	const doi = deposition.metadata.doi ?? `10.5072/zenodo.${deposition.id}`;
	return {
		created: deposition.publishedAt,
		id: deposition.id,
		parent: { id: deposition.parentId, pids: {} },
		pids: { doi: { identifier: doi } },
		metadata: deposition.metadata,
		links: {
			self_html: `https://sandbox.zenodo.org/records/${deposition.id}`,
		},
	};
}

function draftFile(deposition, filename) {
	const bytes = deposition.files.get(filename) ?? Buffer.alloc(0);
	const encodedFilename = encodeURIComponent(filename);
	return {
		key: filename,
		status: deposition.pendingFiles.has(filename) ? "pending" : "completed",
		file_id: `file-${encodedFilename}`,
		checksum: `md5:${createHash("md5").update(bytes).digest("hex")}`,
		size: bytes.byteLength,
		links: {
			self: `https://sandbox.zenodo.org/api/records/${deposition.id}/draft/files/${encodedFilename}`,
			content: `https://sandbox.zenodo.org/api/records/${deposition.id}/draft/files/${encodedFilename}/content`,
			commit: `https://sandbox.zenodo.org/api/records/${deposition.id}/draft/files/${encodedFilename}/commit`,
		},
	};
}

function unixrefFromDeposit() {
	const report = crossrefXml?.match(
		/<report-paper\b[\s\S]*?<\/report-paper>/u,
	)?.[0];
	return report
		? `<?xml version="1.0" encoding="UTF-8"?><doi_records><doi_record><crossref>${report}</crossref></doi_record></doi_records>`
		: `<?xml version="1.0" encoding="UTF-8"?><doi_records />`;
}

function crossrefValue(tag) {
	const value = crossrefXml?.match(
		new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]+)</${tag}>`, "u"),
	)?.[1];
	return value
		? value
				.replaceAll("&amp;", "&")
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")
				.replaceAll("&quot;", '"')
				.replaceAll("&apos;", "'")
		: null;
}

const server = createServer(async (request, response) => {
	const url = new URL(
		request.url ?? "/",
		`http://${request.headers.host ?? "fixture"}`,
	);
	const method = request.method ?? "GET";

	if (url.pathname === "/health") return text(response, 200, "healthy");
	if (url.pathname === "/_test/state") {
		return json(response, 200, {
			crossrefDeposits,
			crossref: crossrefXml
				? {
						doi: crossrefValue("doi"),
						title: crossrefValue("title"),
					}
				: null,
			zenodo: [...depositions.values()].map((deposition) => ({
				id: deposition.id,
				published: deposition.published,
				doi: deposition.metadata.doi ?? null,
				files: [...deposition.files.keys()],
			})),
		});
	}

	if (url.pathname.startsWith("/storage/v1/object/")) {
		if (method === "GET") {
			return text(response, 200, storageBytes, "application/pdf");
		}
		if (method === "DELETE") return json(response, 200, []);
	}

	if (url.pathname === "/servlet/deposit" && method === "POST") {
		const body = (await readBody(request)).toString("utf8");
		crossrefXml = body.match(/<\?xml[\s\S]*?<\/doi_batch>/u)?.[0] ?? null;
		crossrefDeposits += 1;
		return text(response, 200, "queued");
	}
	if (url.pathname === "/servlet/submissionDownload" && method === "POST") {
		return text(
			response,
			200,
			`<doi_batch_diagnostic status="completed"><batch_data><record_count>1</record_count><success_count>1</success_count><failure_count>0</failure_count></batch_data></doi_batch_diagnostic>`,
			"application/xml",
		);
	}
	if (url.pathname === "/openurl" && method === "GET") {
		return text(response, 200, unixrefFromDeposit(), "application/xml");
	}

	if (url.pathname === "/api/records" && method === "GET") {
		const query = url.searchParams.get("q") ?? "";
		const requestedDoi = query.match(/doi:"([^"]+)"/u)?.[1]?.toLowerCase();
		const hits = [...depositions.values()]
			.filter((deposition) => deposition.published)
			.map(publishedRecord)
			.filter(
				(record) =>
					record.pids.doi.identifier.toLowerCase() === requestedDoi,
			);
		return json(response, 200, { hits: { hits } });
	}
	if (url.pathname === "/api/deposit/depositions" && method === "GET") {
		return json(
			response,
			200,
			[...depositions.values()]
				.filter((deposition) => !deposition.published)
				.map(depositionJson),
		);
	}
	if (url.pathname === "/api/deposit/depositions" && method === "POST") {
		const id = String(nextDepositionId++);
		const deposition = {
			id,
			parentId: String(Number(id) - 1),
			metadata: {},
			files: new Map(),
			pendingFiles: new Set(),
			published: false,
			publishedAt: null,
		};
		depositions.set(id, deposition);
		return json(response, 201, depositionJson(deposition));
	}

	const bucketMatch = url.pathname.match(
		/^\/api\/files\/bucket-(\d+)\/(.+)$/u,
	);
	if (bucketMatch && method === "PUT") {
		const deposition = depositions.get(bucketMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing deposition" });
		deposition.files.set(
			decodeURIComponent(bucketMatch[2]),
			await readBody(request),
		);
		return json(response, 200, { key: decodeURIComponent(bucketMatch[2]) });
	}

	const depositionMatch = url.pathname.match(
		/^\/api\/deposit\/depositions\/(\d+)$/u,
	);
	if (depositionMatch) {
		const deposition = depositions.get(depositionMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing deposition" });
		if (method === "GET")
			return json(response, 200, depositionJson(deposition));
		if (method === "PUT") {
			const body = JSON.parse((await readBody(request)).toString("utf8"));
			deposition.metadata = body.metadata ?? {};
			return json(response, 200, depositionJson(deposition));
		}
		if (method === "DELETE") {
			depositions.delete(deposition.id);
			response.writeHead(204).end();
			return;
		}
	}

	const recordDraftMatch = url.pathname.match(
		/^\/api\/records\/(\d+)\/draft$/u,
	);
	if (recordDraftMatch && method === "POST") {
		const deposition = depositions.get(recordDraftMatch[1]);
		if (!deposition?.published)
			return json(response, 404, { message: "missing record" });
		return json(response, 201, {
			id: deposition.id,
			parent: { id: deposition.parentId },
			links: {
				file_modification: `https://sandbox.zenodo.org/api/records/${deposition.id}/file-modification`,
			},
		});
	}

	const fileModificationMatch = url.pathname.match(
		/^\/api\/records\/(\d+)\/file-modification$/u,
	);
	if (fileModificationMatch && method === "POST") {
		return json(response, 200, { status: "accepted" });
	}

	const draftFilesMatch = url.pathname.match(
		/^\/api\/records\/(\d+)\/draft\/files$/u,
	);
	if (draftFilesMatch) {
		const deposition = depositions.get(draftFilesMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing record" });
		if (method === "GET") {
			return json(response, 200, {
				entries: [...deposition.files.keys()].map((filename) =>
					draftFile(deposition, filename),
				),
			});
		}
		if (method === "POST") {
			const requested = JSON.parse(
				(await readBody(request)).toString("utf8"),
			);
			for (const { key } of requested) {
				deposition.files.set(key, Buffer.alloc(0));
				deposition.pendingFiles.add(key);
			}
			return json(response, 201, {
				entries: [...deposition.files.keys()].map((filename) =>
					draftFile(deposition, filename),
				),
			});
		}
	}

	const draftFileMatch = url.pathname.match(
		/^\/api\/records\/(\d+)\/draft\/files\/([^/]+)(?:\/(content|commit))?$/u,
	);
	if (draftFileMatch) {
		const deposition = depositions.get(draftFileMatch[1]);
		const filename = decodeURIComponent(draftFileMatch[2]);
		const action = draftFileMatch[3];
		if (!deposition)
			return json(response, 404, { message: "missing record" });
		if (method === "PUT" && action === "content") {
			deposition.files.set(filename, await readBody(request));
			return json(response, 200, draftFile(deposition, filename));
		}
		if (method === "POST" && action === "commit") {
			deposition.pendingFiles.delete(filename);
			return json(response, 200, draftFile(deposition, filename));
		}
		if (method === "DELETE" && !action) {
			deposition.files.delete(filename);
			deposition.pendingFiles.delete(filename);
			response.writeHead(204).end();
			return;
		}
	}

	const publishDraftMatch = url.pathname.match(
		/^\/api\/records\/(\d+)\/draft\/actions\/publish$/u,
	);
	if (publishDraftMatch && method === "POST") {
		const deposition = depositions.get(publishDraftMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing record" });
		deposition.publishedAt = new Date().toISOString();
		return json(response, 202, publishedRecord(deposition));
	}

	const publishMatch = url.pathname.match(
		/^\/api\/deposit\/depositions\/(\d+)\/actions\/publish$/u,
	);
	if (publishMatch && method === "POST") {
		const deposition = depositions.get(publishMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing deposition" });
		deposition.published = true;
		deposition.publishedAt = new Date().toISOString();
		return json(response, 202, depositionJson(deposition));
	}

	const recordMatch = url.pathname.match(/^\/api\/records\/(\d+)$/u);
	if (recordMatch && method === "GET") {
		const deposition = depositions.get(recordMatch[1]);
		if (!deposition?.published)
			return json(response, 404, { message: "missing record" });
		return json(response, 200, publishedRecord(deposition));
	}

	return json(response, 404, {
		message: `Unhandled ${method} ${url.pathname}`,
	});
});

server.listen(port, "0.0.0.0", () => {
	console.log(`Publication provider fake listening on ${port}`);
});
