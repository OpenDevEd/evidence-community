// fallow-ignore-file unused-file
// Docker Compose starts this fixture directly; it is not imported by TypeScript.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.env.PORT ?? 4000);
const storageBytes = Buffer.from(
	"Evidence Library publication acceptance PDF\n",
);
const depositions = new Map();
// Files uploaded, by bucket and path, kept on the container's disk so a restart of this process keeps them;
// anything else reads as the acceptance PDF.
const STORAGE_DIR = "/tmp/runtime-provider-fake-storage";
mkdirSync(STORAGE_DIR, { recursive: true });
const storedFile = (objectPath) => join(STORAGE_DIR, encodeURIComponent(objectPath));
const storedObjects = {
	get: (objectPath) => (existsSync(storedFile(objectPath)) ? readFileSync(storedFile(objectPath)) : undefined),
	set: (objectPath, bytes) => writeFileSync(storedFile(objectPath), bytes),
};
const adminUsers = { editor: "user_acceptance_admin", creator: "user_acceptance_creator", owner: "user_acceptance_owner" };
function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
const openScholarLibraries = new Map([
	[
		requiredEnvironment("OPENSCHOLAR_AMBER_MACHINE_CREDENTIAL"),
		requiredEnvironment("OPENSCHOLAR_AMBER_LIBRARY_ID"),
	],
	[
		requiredEnvironment("OPENSCHOLAR_INDIGO_MACHINE_CREDENTIAL"),
		requiredEnvironment("OPENSCHOLAR_INDIGO_LIBRARY_ID"),
	],
]);
/** Whether the community takes applications to join, as a test last said, and the reader whose application waits. */
let joinStanding = "open";
const APPLIED_READER = "user_acceptance_applied";
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
		submitted: deposition.published && !deposition.editing,
		state: deposition.editing ? "inprogress" : deposition.published ? "done" : "unsubmitted",
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

// The DOI a deposit names: the external one its draft was given, else the one Zenodo would mint.
function doiOf(deposition) {
	return deposition.draft.pids?.doi?.identifier ?? deposition.metadata.doi ?? null;
}

function publishedRecord(deposition) {
	const doi = doiOf(deposition) ?? `10.5072/zenodo.${deposition.id}`;
	return {
		created: deposition.publishedAt,
		id: deposition.id,
		parent: { id: deposition.parentId, pids: {} },
		pids: { ...deposition.draft.pids, doi: deposition.draft.pids?.doi ?? { identifier: doi } },
		metadata: deposition.draft.metadata,
		custom_fields: deposition.draft.custom_fields,
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


// OpenScholar's collection invitations (OpenDevEd/openalex-count#893), kept in memory. An account
// `user_mock_<name>` has `<name>@example.org` verified; mail to bounce.example.org fails to send.
const COLLECTION_INVITATIONS = "/api/v1/evidence-libraries/collection-invitations/";
const WEEK = 7 * 86_400_000;
const collectionInvitations = new Map();
const invitationEmails = [];
const mockPeople = new Map([
	["user_mock_amina", { name: "Amina Yusuf", emails: ["amina@example.org", "a.yusuf@uni.example.org"] }],
	["user_mock_daniel", { name: "Daniel Mwangi", emails: ["daniel@example.org"] }],
	// The account `npm run verify -- shift --as editor` signs in with.
	["user_acceptance_admin", { name: "Verify editor", emails: ["editor@example.org"] }],
]);
const verifiedEmails = (clerkUserId) =>
	mockPeople.get(clerkUserId)?.emails ?? (clerkUserId.startsWith("user_mock_") ? [`${clerkUserId.slice(10)}@example.org`] : []);
const personName = (clerkUserId) => mockPeople.get(clerkUserId)?.name ?? clerkUserId.replace(/^user_mock_/u, "").replace(/^./u, (letter) => letter.toUpperCase());
const pendingNow = (invitation) => invitation.state === "pending" && invitation.expiresAt > Date.now();
const sentView = ({ id, collectionId, email, role, delivery, sentAt, expiresAt }) => ({ id, collectionId, email, role, delivery, sentAt, expiresAt });

function sendInvitation(invitation) {
	invitation.sentAt = Date.now();
	invitation.expiresAt = invitation.sentAt + WEEK;
	invitation.delivery = invitation.email.endsWith("@bounce.example.org") ? "failed" : "sent";
	if (invitation.delivery === "sent") {
		invitationEmails.unshift({
			invitationId: invitation.id,
			to: invitation.email,
			from: `${personName(invitation.invitedBy)} via the library`,
			inviter: personName(invitation.invitedBy),
			collectionName: invitation.collectionName,
			role: invitation.role,
			sentAt: invitation.sentAt,
		});
	}
}

// One branch per call and refusal, in the order OpenScholar checks them, like the router below.
// fallow-ignore-next-line complexity
async function collectionInvitation(request, response, action) {
	const libraryId = openScholarLibraries.get(request.headers.authorization?.match(/^Bearer ([^\s]+)$/u)?.[1]);
	if (!libraryId) return json(response, 401, { error: "invalid_service_credential" });
	let body;
	try {
		body = JSON.parse((await readBody(request)).toString("utf8"));
	} catch {
		return json(response, 400, { error: "invalid_request" });
	}
	if (body?.contractVersion !== 1 || body.libraryId !== libraryId || typeof body.clerkUserId !== "string") return json(response, 400, { error: "invalid_request" });
	const sentByCaller = (invitation) => invitation?.libraryId === libraryId && invitation.invitedBy === body.clerkUserId;
	if (action === "invite") {
		const email = String(body.email ?? "").trim().toLowerCase();
		if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return json(response, 400, { error: "invalid_email" });
		if (verifiedEmails(body.clerkUserId).includes(email)) return json(response, 400, { error: "own_address" });
		// One still waiting at an address and collection is sent again; one answered, cancelled or expired is replaced by a new invitation with its own ID.
		const existing = [...collectionInvitations.values()].find((invitation) => invitation.libraryId === libraryId && invitation.collectionId === body.collectionId && invitation.email === email);
		if (existing && !pendingNow(existing)) collectionInvitations.delete(existing.id);
		const invitation = existing && pendingNow(existing) ? existing : { id: `inv_${Math.random().toString(36).slice(2, 12)}`, libraryId, collectionId: body.collectionId, email };
		Object.assign(invitation, { collectionName: body.collectionName, role: body.role, invitedBy: body.clerkUserId, state: "pending", acceptedBy: null });
		sendInvitation(invitation);
		collectionInvitations.set(invitation.id, invitation);
		return json(response, 200, sentView(invitation));
	}
	if (action === "list") {
		const invitations = [...collectionInvitations.values()].filter((invitation) => sentByCaller(invitation) && pendingNow(invitation)).sort((a, b) => b.sentAt - a.sentAt);
		return json(response, 200, { invitations: invitations.map(sentView) });
	}
	if (action === "cancel") {
		for (const invitation of collectionInvitations.values()) {
			if (sentByCaller(invitation) && invitation.collectionId === body.collectionId && invitation.state === "pending") invitation.state = "cancelled";
		}
		return json(response, 200, {});
	}
	const invitation = collectionInvitations.get(body.invitationId);
	if (action === "change") {
		if (!sentByCaller(invitation) || !pendingNow(invitation)) return json(response, 404, { error: "not_found" });
		if (body.resend && body.collectionId !== invitation.collectionId) return json(response, 404, { error: "not_found" });
		if (body.cancel) invitation.state = "cancelled";
		else if (body.resend) sendInvitation(Object.assign(invitation, { collectionName: body.collectionName }));
		else if (body.role) invitation.role = body.role;
		return json(response, 200, {});
	}
	const own = invitation?.libraryId === libraryId && verifiedEmails(body.clerkUserId).includes(invitation.email);
	const acceptedByCaller = invitation?.state === "accepted" && invitation.acceptedBy === body.clerkUserId;
	if (action === "read") {
		if (!invitation || invitation.libraryId !== libraryId || !(pendingNow(invitation) || acceptedByCaller)) return json(response, 200, { state: "gone" });
		if (!acceptedByCaller && !own) return json(response, 200, { state: "other" });
		return json(response, 200, { state: invitation.state, collectionId: invitation.collectionId, role: invitation.role });
	}
	if (action === "respond") {
		if (!invitation || invitation.libraryId !== libraryId || invitation.state === "cancelled") return json(response, 404, { error: "not_found" });
		if (acceptedByCaller) return json(response, 200, { collectionId: invitation.collectionId, role: invitation.role });
		if (!own) return json(response, 403, { error: "other_address" });
		if (invitation.state !== "pending") return json(response, 409, { error: "answered" });
		if (invitation.expiresAt <= Date.now()) return json(response, 410, { error: "expired" });
		Object.assign(invitation, body.accept ? { state: "accepted", acceptedBy: body.clerkUserId } : { state: "declined" });
		return json(response, 200, body.accept ? { collectionId: invitation.collectionId, role: invitation.role } : {});
	}
	return json(response, 404, { error: "unknown_action" });
}

// OpenScholar's author profiles, created, looked up by id and searched by name; kept beside the stored files.
const PROFILES_FILE = join(STORAGE_DIR, "..author-profiles.json");
const authorProfiles = new Map(existsSync(PROFILES_FILE) ? JSON.parse(readFileSync(PROFILES_FILE, "utf8")) : []);

// fallow-ignore-next-line complexity
function authorProfileRequest(body) {
	if (body.operation === "create") {
		const profile = { affiliation: body.affiliation ?? "", bio: "", headline: "", id: `profile_${authorProfiles.size + 1}`, linkedin: "", name: String(body.name ?? "").trim(), openalex: "", orcid: "", photo: null, revision: 1, website: "" };
		authorProfiles.set(profile.id, profile);
		writeFileSync(PROFILES_FILE, JSON.stringify([...authorProfiles]));
		return { profiles: [profile] };
	}
	if (body.operation === "resolve") return { profiles: (body.profileIds ?? []).flatMap((id) => (authorProfiles.has(id) ? [authorProfiles.get(id)] : [])) };
	const words = String(body.search ?? "").toLowerCase().split(/\s+/u).filter(Boolean);
	const found = [...authorProfiles.values()].filter(({ name }) => words.every((word) => name.toLowerCase().includes(word)));
	return { continueCursor: null, isDone: true, profiles: found.slice(0, body.paginationOpts?.numItems ?? 12) };
}

const openAlexId = (value) => value.replace("https://openalex.org/", "");

/** An OpenAlex topic, subfield, field or domain as a node of OpenScholar's topic catalogue. */
// fallow-ignore-next-line complexity
function topicNode(node) {
	const id = openAlexId(node.id);
	const above = [node.domain, node.field, node.subfield].filter(Boolean);
	const level = id.startsWith("domains/") ? "domain" : id.startsWith("fields/") ? "field" : id.startsWith("subfields/") ? "subfield" : "topic";
	return { childCount: 0, id, level, name: node.display_name, parent: above.length ? openAlexId(above[above.length - 1].id) : null, path: above.map(({ display_name }) => display_name) };
}

/**
 * OpenScholar's topic catalogue, answered from OpenAlex, where OpenScholar's
 * comes from: a search or an id lookup returns topics, and the top level
 * returns none, which is all the runtime asks of it here.
 */
async function topicCatalog(body) {
	return { contractVersion: 1, nextCursor: null, nodes: (await topicLookup(body)).map(topicNode), publicBaseUrl: "https://openalex.org", revision: "openalex" };
}

const OPENALEX_ACCESS = process.env.OPENALEX_API_KEY ? `api_key=${process.env.OPENALEX_API_KEY}` : "mailto=doi-acceptance@example.org";
const openAlexUrl = (path) => `https://api.openalex.org${path}${path.includes("?") ? "&" : "?"}${OPENALEX_ACCESS}`;

// OpenAlex limits how fast it may be searched; a refused or slow answer is no topics, not a failure.
async function openAlexJson(path) {
	const response = await fetch(openAlexUrl(path), { signal: AbortSignal.timeout(10_000) }).catch(() => null);
	return response?.ok ? response.json() : null;
}

/** The OpenAlex topics a search or an id lookup asks for. */
function topicLookup(body) {
	return body.query ? searchTopics(body.query, body.limit) : topicsById(body.ids);
}

async function searchTopics(query, limit = 25) {
	const found = await openAlexJson(`/topics?search=${encodeURIComponent(query)}&per-page=${Math.min(limit, 50)}`);
	return found?.results ?? [];
}

async function topicsById(ids = []) {
	const known = ids.filter((id) => /^(?:T\d+|(?:domains|fields|subfields)\/\d+)$/u.test(id));
	return (await Promise.all(known.map((id) => openAlexJson(id.startsWith("T") ? `/topics/${id}` : `/${id}`)))).filter(Boolean);
}

// fallow-ignore-next-line complexity
async function handle(request, response) {
	const url = new URL(
		request.url ?? "/",
		`http://${request.headers.host ?? "fixture"}`,
	);
	const method = request.method ?? "GET";

	if (url.pathname === "/health") return text(response, 200, "healthy");
	if (url.pathname === "/api/v1/evidence-libraries/author-profiles" && method === "POST") {
		const body = JSON.parse((await readBody(request)).toString("utf8"));
		// As OpenScholar does, a search or a new profile says which of the library's people asks for it.
		if (body.operation !== "resolve" && !body.clerkUserId) return json(response, 400, { error: "clerkUserId is required" });
		return json(response, 200, authorProfileRequest(body));
	}
	if (url.pathname === "/api/v1/evidence-libraries/topics/catalog" && method === "POST") {
		return json(response, 200, await topicCatalog(JSON.parse((await readBody(request)).toString("utf8"))));
	}
	if (url.pathname === "/export" && method === "POST") {
		const items = JSON.parse((await readBody(request)).toString("utf8"));
		return json(response, 200, items.map((item, index) => ({
			id: `runtime-citation-${index}`,
			type: "report",
			title: item.title,
			issued: { "date-parts": [[2026]] },
		})));
	}
	// The library's OAuth client discovers OpenScholar's Clerk instance here.
	// Browser suites sign in through Better Auth's test helpers, so the
	// authorization page only has to exist for the redirect to be checked.
	if (url.pathname === "/.well-known/openid-configuration") {
		const origin = `https://${request.headers.host}`;
		return json(response, 200, {
			issuer: origin,
			authorization_endpoint: `${origin}/oauth/authorize`,
			token_endpoint: `${origin}/oauth/token`,
			userinfo_endpoint: `${origin}/oauth/userinfo`,
			response_types_supported: ["code"],
			code_challenge_methods_supported: ["S256"],
		});
	}
	if (url.pathname === "/oauth/authorize") {
		return text(response, 200, "OpenScholar sign-in", "text/plain");
	}
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
				doi: doiOf(deposition),
				files: [...deposition.files.keys()],
			})),
		});
	}

	// A test says whether the community takes applications: `open` until it says otherwise.
	if (url.pathname === "/_test/join-standing" && method === "POST") {
		joinStanding = JSON.parse((await readBody(request)).toString("utf8")).join ?? "open";
		return json(response, 200, { join: joinStanding });
	}

	if (
		[
			"/api/v1/evidence-libraries/admin-session/check",
			"/api/v1/evidence-libraries/reader-status",
			"/api/v1/evidence-libraries/join-standing",
			"/api/v1/evidence-libraries/papers/search",
		].includes(url.pathname) &&
		method === "POST"
	) {
		const credential =
			request.headers.authorization?.match(/^Bearer ([^\s]+)$/u)?.[1];
		const credentialLibraryId = openScholarLibraries.get(credential);
		if (!credentialLibraryId) {
			return json(response, 401, {
				error: "invalid_service_credential",
			});
		}

		let body;
		try {
			body = JSON.parse((await readBody(request)).toString("utf8"));
		} catch {
			return json(response, 400, { error: "invalid_request" });
		}
		if (url.pathname === "/api/v1/evidence-libraries/reader-status") {
			return json(response, 200, { status: "active" });
		}
		// Where a reader stands with joining: the one reader who applied waits; everyone else has the community's word.
		if (url.pathname === "/api/v1/evidence-libraries/join-standing") {
			return json(response, 200, { join: joinStanding === "open" && body?.clerkUserId === APPLIED_READER ? "waiting" : joinStanding });
		}
		// A title finds one paper OpenAlex has, and none for a title of nonsense.
		if (url.pathname === "/api/v1/evidence-libraries/papers/search") {
			return json(response, 200, { papers: /^z+q+/iu.test(String(body?.query ?? "")) ? [] : [{ openalexId: "W2741809807", doi: "10.7717/peerj.4375" }] });
		}
		const role = Object.keys(adminUsers).find((name) => adminUsers[name] === body?.clerkUserId);
		if (body?.libraryId !== credentialLibraryId || !role) {
			return json(response, 403, { error: "access_revoked", organisationName: "Acceptance organisation" });
		}
		return json(response, 200, { role });
	}

	if (url.pathname.startsWith(COLLECTION_INVITATIONS) && method === "POST") {
		return collectionInvitation(request, response, url.pathname.slice(COLLECTION_INVITATIONS.length));
	}
	// The mock inbox and test controls for collection invitations.
	if (url.pathname === "/_test/collection-invitations" && method === "GET") {
		return json(response, 200, { invitations: [...collectionInvitations.values()], emails: invitationEmails });
	}
	if (url.pathname === "/_test/collection-invitations/expire" && method === "POST") {
		const invitation = collectionInvitations.get(url.searchParams.get("id"));
		if (invitation) invitation.expiresAt = Date.now() - 1;
		return json(response, invitation ? 200 : 404, {});
	}
	// Signed uploads as the admin's PDF upload makes them: the server signs a
	// path, then the browser sends the file to it from another origin.
	const signed = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/(.+)$/u);
	if (signed) {
		const cors = { "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "PUT", "Access-Control-Allow-Origin": "*" };
		if (method === "OPTIONS") {
			response.writeHead(204, cors);
			return response.end();
		}
		if (method === "POST") return json(response, 200, { url: `/object/upload/sign/${signed[1]}?token=fixture` });
		if (method === "PUT") {
			const form = await new Request(url, { body: await readBody(request), headers: { "content-type": request.headers["content-type"] ?? "" }, method }).formData().catch(() => null);
			const file = form && [...form.values()].find((value) => typeof value !== "string");
			if (!file) return json(response, 400, { error: "Send the file as multipart form data" });
			storedObjects.set(signed[1], Buffer.from(await file.arrayBuffer()));
			response.writeHead(200, { ...cors, "Content-Type": "application/json" });
			return response.end(JSON.stringify({ Key: signed[1] }));
		}
	}

	if (url.pathname.startsWith("/storage/v1/object/")) {
		const objectPath = url.pathname.slice("/storage/v1/object/".length).replace(/^(?:authenticated|public)\//u, "");
		if (method === "GET") {
			return text(response, 200, storedObjects.get(objectPath) ?? storageBytes, "application/pdf");
		}
		if (method === "POST" || method === "PUT") {
			storedObjects.set(objectPath, await readBody(request));
			return json(response, 200, { Key: objectPath });
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
			// What the InvenioRDM draft holds: the metadata the package writes, in that format.
			draft: { metadata: {}, custom_fields: {}, pids: {} },
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

    const depositionFilesMatch = url.pathname.match(/^\/api\/deposit\/depositions\/(\d+)\/files$/u);
    if (depositionFilesMatch && method === "GET") {
        const deposition = depositions.get(depositionFilesMatch[1]);
        if (!deposition) return json(response, 404, {message: "missing deposition"});
        return json(response, 200, depositionJson(deposition).files);
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
	if (recordDraftMatch && (method === "GET" || method === "PUT")) {
		const deposition = depositions.get(recordDraftMatch[1]);
		if (!deposition) return json(response, 404, { message: "missing draft" });
		if (method === "PUT") {
			const body = JSON.parse((await readBody(request)).toString("utf8"));
			deposition.draft = { metadata: body.metadata ?? {}, custom_fields: body.custom_fields ?? {}, pids: body.pids ?? {} };
		}
		return json(response, 200, { id: deposition.id, ...deposition.draft, errors: [] });
	}
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

    const editDepositionMatch = url.pathname.match(/^\/api\/deposit\/depositions\/(\d+)\/actions\/edit$/u);
    if (editDepositionMatch && method === "POST") {
        const deposition = depositions.get(editDepositionMatch[1]);
        if (!deposition?.published) return json(response, 404, {message: "missing published deposition"});
        deposition.editing = true;
        return json(response, 201, depositionJson(deposition));
    }

	const publishMatch = url.pathname.match(
		/^\/api\/deposit\/depositions\/(\d+)\/actions\/publish$/u,
	);
	if (publishMatch && method === "POST") {
		const deposition = depositions.get(publishMatch[1]);
		if (!deposition)
			return json(response, 404, { message: "missing deposition" });
		deposition.published = true;
		deposition.editing = false;
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
}

// One request that throws answers 500; it must not stop the process, which also holds the uploaded files.
const server = createServer((request, response) => {
	handle(request, response).catch((error) => {
		console.error("Fake request failed", request.method, request.url, error);
		if (!response.headersSent) json(response, 500, { error: "fixture_failure", message: String(error?.message ?? error) });
		else response.end();
	});
});

server.listen(port, "0.0.0.0", () => {
	console.log(`Publication provider fake listening on ${port}`);
});
