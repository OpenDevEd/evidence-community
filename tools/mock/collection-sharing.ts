// fallow-ignore-file unused-file
/**
 * Mock review only (EL-26, OpenDevEd/new-el#578 and #579). Run after
 * `npm run verify -- up`: it adds readers, collections, members and
 * invitations to the verify library, then serves a page on this machine to
 * sign in as any of them and to read the invitation emails the fake
 * OpenScholar sent. `npx tsx tools/mock/collection-sharing.ts [port]`
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import pg from "pg";

import { mintReaderSessionCookies } from "../readerTestSession";

const stack = JSON.parse(readFileSync(".verify/stack.json", "utf8"));
const config = JSON.parse(readFileSync(stack.config, "utf8"));
const branchUrl: string = stack.branch.url;
const fakeUrl = `http://127.0.0.1:${stack.ports.fake}`;
const port = Number(process.argv[2] ?? stack.ports.branch + 50);
const { libraryId, machineCredential } = config.authentication.openScholar;

const people = [
	{ clerk: "user_mock_amina", name: "Amina Yusuf", image: "https://randomuser.me/api/portraits/women/44.jpg", note: "Owns Early literacy, Teacher coaching and Reading at home" },
	{ clerk: "user_mock_daniel", name: "Daniel Mwangi", image: "https://randomuser.me/api/portraits/men/32.jpg", note: "Edits Early literacy; owns two he shared with Amina" },
	{ clerk: "user_mock_priya", name: "Priya Raman", image: "https://randomuser.me/api/portraits/women/65.jpg", note: "Views Early literacy, edits Teacher coaching" },
	{ clerk: "user_mock_joseph", name: "Joseph Otieno", image: "https://randomuser.me/api/portraits/men/75.jpg", note: "Edits Early literacy" },
	{ clerk: "user_mock_grace", name: "Grace Achieng", image: "https://randomuser.me/api/portraits/women/31.jpg", note: "Views Daniel's Classroom technology" },
	{ clerk: "user_mock_sam", name: "Sam Carter", image: "https://randomuser.me/api/portraits/men/12.jpg", note: "Invited to Teacher coaching as sam@example.org; not in the library yet" },
	{ clerk: "user_mock_lucia", name: "Lucía Fernández", image: "https://randomuser.me/api/portraits/women/22.jpg", note: "Invited to Early literacy as lucia@example.org" },
];
const readerId = (clerk: string) => `reader-${clerk}`;

type CollectionSeed = { id: string; owner: string; name: string; description: string | null; private: boolean; records: number; members: [string, "editor" | "viewer"][] };
const collections: CollectionSeed[] = [
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0001", owner: "user_mock_amina", name: "Early literacy", description: "Phonics and reading programmes we compare in the review", private: true, records: 9, members: [["user_mock_daniel", "editor"], ["user_mock_priya", "viewer"], ["user_mock_joseph", "editor"]] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0002", owner: "user_mock_amina", name: "Teacher coaching", description: "Coaching and mentoring studies", private: false, records: 6, members: [["user_mock_priya", "editor"]] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0003", owner: "user_mock_amina", name: "Reading at home", description: null, private: true, records: 3, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0004", owner: "user_mock_daniel", name: "Classroom technology", description: "Tablets, radio and SMS in classrooms", private: false, records: 7, members: [["user_mock_amina", "editor"], ["user_mock_grace", "viewer"]] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0005", owner: "user_mock_daniel", name: "Girls in STEM", description: null, private: true, records: 4, members: [["user_mock_amina", "viewer"]] },
	// For `npm run verify -- shift --as editor`, whose account is user_acceptance_admin.
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0006", owner: "user_acceptance_admin", name: "Verify shared", description: "Shared for the motion checks", private: true, records: 5, members: [["user_mock_daniel", "editor"], ["user_mock_priya", "viewer"]] },
	// Enough of the verify editor's own for two pages of the profile's column.
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0020", owner: "user_acceptance_admin", name: "Numeracy", description: null, private: false, records: 3, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0021", owner: "user_acceptance_admin", name: "Early grade reading", description: null, private: false, records: 2, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0022", owner: "user_acceptance_admin", name: "Teacher training", description: null, private: false, records: 4, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0023", owner: "user_acceptance_admin", name: "Inclusion", description: null, private: false, records: 1, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0024", owner: "user_acceptance_admin", name: "Assessment", description: null, private: false, records: 2, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0025", owner: "user_acceptance_admin", name: "Distance learning", description: null, private: false, records: 3, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0026", owner: "user_acceptance_admin", name: "Language of instruction", description: null, private: false, records: 2, members: [] },
	// Enough of Amina's own to fill more than one page of the record picker.
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0010", owner: "user_mock_amina", name: "Assessment tools", description: "Reading and maths tests used in the studies", private: false, records: 4, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0011", owner: "user_mock_amina", name: "Mother tongue", description: null, private: true, records: 2, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0012", owner: "user_mock_amina", name: "School feeding", description: "Meals and attendance", private: false, records: 0, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0013", owner: "user_mock_amina", name: "Remedial programmes", description: null, private: true, records: 5, members: [] },
	{ id: "0e1a9c52-1b7e-4c11-9d6a-5a0c3f1e0014", owner: "user_mock_amina", name: "Girls' education", description: "For the gender chapter", private: true, records: 3, members: [] },
];
const invitations: { collection: number; email: string; role: "editor" | "viewer"; expire?: boolean }[] = [
	{ collection: 0, email: "lucia@example.org", role: "editor" },
	{ collection: 0, email: "k.osei@bounce.example.org", role: "viewer" },
	{ collection: 1, email: "sam@example.org", role: "editor" },
	{ collection: 1, email: "jo.otieno@example.org", role: "viewer" },
	{ collection: 2, email: "old.address@example.org", role: "viewer", expire: true },
	{ collection: 5, email: "lucia@example.org", role: "editor" },
	// An invitation the verify editor opens.
	{ collection: 0, email: "editor@example.org", role: "editor" },
];

async function seed() {
	const client = new pg.Client({ connectionString: config.services.database.url });
	await client.connect();
	try {
		const keys = (await client.query<{ key: string }>(`select "key" from "item" where "key" like 'V%' order by "key" limit 40`)).rows.map((row) => row.key);
		await client.query(
			`insert into reader_user (id, name, email, "emailVerified", image) values ('reader-user_acceptance_admin', 'Verify editor', 'user_acceptance_admin@readers.openscholar.invalid', true, null) on conflict do nothing`,
		);
		await client.query(
			`insert into reader_account (id, "userId", "providerId", "accountId") values ('account-user_acceptance_admin', 'reader-user_acceptance_admin', 'openscholar', 'user_acceptance_admin') on conflict do nothing`,
		);
		for (const person of people.filter((candidate) => !["user_mock_sam", "user_mock_lucia"].includes(candidate.clerk))) {
			await client.query(
				`insert into reader_user (id, name, email, "emailVerified", image) values ($1, $2, $3, true, $4)
				 on conflict (id) do update set name = excluded.name, image = excluded.image`,
				[readerId(person.clerk), person.name, `${person.clerk}@readers.openscholar.invalid`, person.image],
			);
			await client.query(
				`insert into reader_account (id, "userId", "providerId", "accountId") values ($1, $2, 'openscholar', $3) on conflict do nothing`,
				[`account-${person.clerk}`, readerId(person.clerk), person.clerk],
			);
		}
		await client.query(`delete from reader_bookmark where "userId" = $1`, [readerId("user_mock_amina")]);
		for (const key of keys.slice(0, 14)) await client.query(`insert into reader_bookmark ("userId", "itemKey") values ($1, $2)`, [readerId("user_mock_amina"), key]);
		for (const [index, collection] of collections.entries()) {
			await client.query(
				`insert into reader_collection (id, "userId", name, description, private, "createdAt") values ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)
				 on conflict (id) do update set name = excluded.name, description = excluded.description, private = excluded.private`,
				[collection.id, readerId(collection.owner), collection.name, collection.description, collection.private, String(30 - index)],
			);
			await client.query(`delete from reader_collection_item where "collectionId" = $1`, [collection.id]);
			// Wraps round the records, so every collection gets its count however many there are.
			for (const key of Array.from({ length: collection.records }, (_, offset) => keys[(index * 3 + offset) % keys.length]!)) {
				await client.query(`insert into reader_collection_item ("collectionId", "itemKey") values ($1, $2)`, [collection.id, key]);
			}
			await client.query(`delete from reader_collection_member where "collectionId" = $1`, [collection.id]);
			for (const [days, [member, role]] of collection.members.entries()) {
				await client.query(
					`insert into reader_collection_member ("collectionId", "userId", role, "createdAt") values ($1, $2, $3, now() - ($4 || ' days')::interval)`,
					[collection.id, readerId(member), role, String(20 - days * 3)],
				);
			}
		}
	} finally {
		await client.end();
	}
	for (const invitation of invitations) {
		const collection = collections[invitation.collection]!;
		const response = await fetch(`${fakeUrl}/api/v1/evidence-libraries/collection-invitations/invite`, {
			method: "POST",
			headers: { Authorization: `Bearer ${machineCredential}`, "Content-Type": "application/json" },
			body: JSON.stringify({ contractVersion: 1, libraryId, clerkUserId: collection.owner, collectionId: collection.id, collectionName: collection.name, email: invitation.email, role: invitation.role }),
		});
		const sent = (await response.json()) as { id: string };
		if (invitation.expire) await fetch(`${fakeUrl}/_test/collection-invitations/expire?id=${sent.id}`, { method: "POST" });
	}
}

const escape = (text: string) => text.replace(/[&<>"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);

async function indexPage() {
	const state = (await (await fetch(`${fakeUrl}/_test/collection-invitations`)).json()) as {
		invitations: { id: string; email: string; collectionName: string; role: string; state: string; expiresAt: number }[];
		emails: { invitationId: string; to: string; from: string; inviter: string; collectionName: string; role: string; sentAt: number }[];
	};
	const library = escape(config.identity?.name ?? "the library");
	const person = (entry: (typeof people)[number]) => `
		<li><img src="${entry.image}" alt=""><div><b>${escape(entry.name)}</b><span>${escape(entry.note)}</span></div>
		<a href="/as/${entry.clerk}?next=/profile/${readerId(entry.clerk)}">Profile</a>
		<a href="/as/${entry.clerk}?next=/lib">Library</a></li>`;
	const email = (entry: (typeof state.emails)[number]) => `
		<article><header><b>${escape(entry.from)}</b><span>to ${escape(entry.to)}</span><time>${new Date(entry.sentAt).toLocaleString()}</time></header>
		<h3>${escape(entry.inviter)} shared ${escape(entry.collectionName)} with you</h3>
		<p>${escape(entry.inviter)} invited you to ${entry.role === "editor" ? "add records to" : "read"} the collection <b>${escape(entry.collectionName)}</b> in ${library}.</p>
		<a class="button" href="${branchUrl}/invitations/${entry.invitationId}">Open invitation</a>
		<p class="small">Sign in with the OpenScholar account for ${escape(entry.to)}. The invitation expires in seven days.</p></article>`;
	const rows = state.invitations
		.map((entry) => `<tr><td>${escape(entry.email)}</td><td>${escape(entry.collectionName)}</td><td>${entry.role}</td><td>${entry.expiresAt < Date.now() && entry.state === "pending" ? "expired" : entry.state}</td><td><a href="${branchUrl}/invitations/${entry.id}">page</a></td></tr>`)
		.join("");
	return `<!doctype html><meta charset="utf-8"><title>Collection sharing mock</title>
	<style>
		body{font:15px/1.5 system-ui;margin:0;background:#f4f2ef;color:#222}main{max-width:1100px;margin:auto;padding:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
		h1{grid-column:1/-1;margin:0}h2{margin:0 0 12px;font-size:17px}section{background:#fff;border-radius:16px;padding:20px}
		ul{list-style:none;margin:0;padding:0}li{display:flex;align-items:center;gap:12px;padding:8px 0}li img{width:40px;height:40px;border-radius:50%}
		li div{flex:1;display:flex;flex-direction:column}li span{font-size:13px;color:#777}a{color:#c2410c;font-weight:600;text-decoration:none;margin-left:8px}
		article{border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:12px}article header{display:flex;gap:8px;font-size:13px;color:#777}article header b{color:#222}
		article time{margin-left:auto}h3{margin:10px 0 4px;font-size:16px}.button{display:inline-block;background:#eb7e1d;color:#fff;padding:10px 16px;border-radius:10px;margin:8px 0 0}
		.small{font-size:12px;color:#888}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:6px 4px;border-top:1px solid #eee}
	</style>
	<main><h1>Collection sharing mock</h1>
	<section><h2>Sign in as</h2><ul>${people.map(person).join("")}</ul><p><a href="/signout">Sign out</a> to see an invitation page signed out.</p></section>
	<section><h2>Emails OpenScholar sent</h2>${state.emails.map(email).join("") || "<p>None yet</p>"}</section>
	<section style="grid-column:1/-1"><h2>Every invitation</h2><table>${rows}</table></section></main>`;
}

async function cookiesFor(clerk: string) {
	const entry = people.find((candidate) => candidate.clerk === clerk);
	const { cookies, readerId: id } = await mintReaderSessionCookies(
		{ databaseUrl: config.services.database.url, secret: config.authentication.secret, libraryBaseUrl: config.identity.baseUrl },
		clerk,
		{ name: entry?.name ?? clerk, cookieDomain: "localhost" },
	);
	if (entry) {
		const client = new pg.Client({ connectionString: config.services.database.url });
		await client.connect();
		await client.query(`update reader_user set image = $2, name = $3 where id = $1`, [id, entry.image, entry.name]).finally(() => client.end());
	}
	return cookies;
}

void seed().then(() => createServer(async (request, response) => {
	const url = new URL(request.url ?? "/", `http://localhost:${port}`);
	try {
		const signIn = url.pathname.match(/^\/as\/(user_mock_[a-z]+)$/u);
		if (signIn) {
			const cookies = await cookiesFor(signIn[1]!);
			response.writeHead(302, {
				location: `${branchUrl}${url.searchParams.get("next") ?? "/"}`,
				"set-cookie": cookies.map((cookie) => `${cookie.name}=${cookie.value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`),
			});
			return response.end();
		}
		if (url.pathname === "/signout") {
			const cookies = await cookiesFor("user_mock_amina");
			response.writeHead(302, { location: "/", "set-cookie": cookies.map((cookie) => `${cookie.name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`) });
			return response.end();
		}
		if (url.pathname === "/reseed") {
			await seed();
			response.writeHead(302, { location: "/" });
			return response.end();
		}
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(await indexPage());
	} catch (error) {
		response.writeHead(500, { "content-type": "text/plain" });
		response.end(String(error instanceof Error ? error.stack : error));
	}
}).listen(port, "127.0.0.1", () => console.log(`Collection sharing mock helper on http://localhost:${port}`)));
