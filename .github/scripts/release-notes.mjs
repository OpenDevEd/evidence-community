// Writes the plain-language notes for one runtime image release.
//
// Input on stdin: the first-parent commits since the previous release, as
// `git log --first-parent --format='%H%x1f%s%x1f%b%x1e'` prints them.
// Output on stdout: the release body that OpenScholar shows to library
// owners. The first line is a one-sentence summary; every note is a `- `
// line. Anything else in the body is ignored by OpenScholar.
//
// The model is reached through OpenRouter, the same gateway OpenScholar uses.
// The script has no dependencies so the job needs only Node.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const GITHUB_ORIGIN = "https://api.github.com";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/responses";
export const MODEL = "openai/gpt-6-luna";
const MAX_ENTRIES = 40;
const MAX_ENTRY_CHARS = 4000;
// Maximum reasoning can take several minutes on a long range.
const REQUEST_TIMEOUT_MS = 10 * 60_000;

export const NOTHING_VISIBLE = "Behind-the-scenes improvements and maintenance.";

// The parts of a library that owners recognise. The model files every note
// under one of them, which keeps the wording anchored to the product.
export const AREAS = {
	search: "finding records on the public site",
	records: "record pages, fields, files and links",
	collections: "collections and how records are grouped",
	sources: "imports, Zotero and other sources, sync and writeback",
	exports: "RIS, BibTeX, feeds and other downloads",
	appearance: "look, wording, languages and accessibility of the site",
	administration: "the admin area, editing, publishing and team access",
	speed: "loading and response times",
	reliability: "things that used to fail or behave wrongly",
};

export const INSTRUCTIONS = `You write update notes for the Evidence Library, a website a research organisation runs to publish research records (papers, reports, datasets) with search, collections, sources such as Zotero, exports, files and an admin area. The readers own or edit such a library. They are not developers.

You receive the changes merged since the previous update. Tell readers what is different for them now.

Rules:
- Describe only what an owner, editor or visitor can notice: what they see, do or get. Skip refactors, tests, CI, builds, dependency updates, logging, internal APIs, database changes and developer tooling. If nothing is noticeable, return an empty list.
- One short sentence per note, at most 25 words, present tense, plain words. Say what is different now, not how it was built. Prefer several short notes over one long one.
- Never mention file names, function names, routes, tables, migrations, containers, services, vendors, environment variables, or commit and pull request numbers. Names visible in the product are fine, such as Zotero, RIS, BibTeX, DOI, OpenAlex and Crossref.
- Merge related changes into one note. Do not repeat a point.
- Do not claim anything the changes do not support. Do not guess at benefits.
- Order notes by how much readers will care.
- The summary is one short sentence covering the whole update, shown in a list of updates.

Areas:
${Object.entries(AREAS)
	.map(([area, meaning]) => `- ${area}: ${meaning}`)
	.join("\n")}`;

const OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["summary", "notes"],
	properties: {
		summary: { type: "string" },
		notes: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["area", "note"],
				properties: {
					area: { type: "string", enum: Object.keys(AREAS) },
					note: { type: "string" },
				},
			},
		},
	},
};

/** One record per commit from the `git log` format described above. */
export function parseCommits(log) {
	return log
		.split("")
		.map((record) => record.replace(/^\n/, ""))
		.filter((record) => record.trim() !== "")
		.map((record) => {
			const [sha = "", subject = "", body = ""] = record.split("");
			return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
		})
		.filter((commit) => /^[a-f0-9]{40}$/.test(commit.sha));
}

/** The pull request a merge or squash commit came from, if its subject says. */
export function pullRequestNumber(subject) {
	const match =
		/\(#(\d+)\)\s*$/.exec(subject) ?? /^Merge pull request #(\d+)\b/.exec(subject);
	return match ? Number(match[1]) : null;
}

async function fetchJson(fetchImpl, url, init) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		let response;
		try {
			response = await fetchImpl(url, { ...init, signal: controller.signal });
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(`The request to ${url} took longer than ${REQUEST_TIMEOUT_MS / 60_000} minutes`);
			}
			throw error;
		}
		const text = await response.text();
		let body = null;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			body = null;
		}
		return { status: response.status, body, text };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * What each commit changed, in the words of its pull request when there is
 * one. A commit without a pull request keeps its own subject and body.
 */
export async function describeChanges({ commits, repository, githubToken, fetchImpl = fetch }) {
	const entries = [];
	for (const commit of commits.slice(0, MAX_ENTRIES)) {
		const number = pullRequestNumber(commit.subject);
		let title = commit.subject;
		let details = commit.body;
		if (number !== null) {
			const { status, body } = await fetchJson(
				fetchImpl,
				`${GITHUB_ORIGIN}/repos/${repository}/pulls/${number}`,
				{
					headers: {
						accept: "application/vnd.github+json",
						authorization: `Bearer ${githubToken}`,
						"user-agent": "evidence-library-release-notes",
						"x-github-api-version": "2022-11-28",
					},
				},
			);
			if (status === 200 && body && typeof body.title === "string") {
				title = body.title;
				details = typeof body.body === "string" ? body.body : "";
			} else if (status !== 404) {
				throw new Error(`GitHub returned ${status} for pull request #${number}`);
			}
		}
		entries.push({ title, details: details.slice(0, MAX_ENTRY_CHARS) });
	}
	return entries;
}

export function buildInput(entries) {
	return entries
		.map((entry, index) => {
			const details = entry.details.trim();
			return `### ${index + 1}. ${entry.title}${details ? `\n${details}` : ""}`;
		})
		.join("\n\n");
}

function outputText(response) {
	for (const item of response.output ?? []) {
		if (item.type !== "message") continue;
		for (const part of item.content ?? []) {
			if (part.type === "output_text" && typeof part.text === "string") return part.text;
		}
	}
	return null;
}

/** The model's answer, checked against the shape the schema promised. */
export function parseNotes(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("The model did not return JSON");
	}
	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof parsed.summary !== "string" ||
		!Array.isArray(parsed.notes)
	) {
		throw new Error("The model answer is not a release note");
	}
	const notes = parsed.notes.map((note) => {
		if (!note || typeof note.note !== "string" || !(note.area in AREAS)) {
			throw new Error("The model answer has a note without an area");
		}
		return { area: note.area, note: note.note.trim() };
	});
	return { summary: parsed.summary.trim(), notes: notes.filter((note) => note.note !== "") };
}

export async function askModel({ input, apiKey, fetchImpl = fetch }) {
	const { status, body, text } = await fetchJson(fetchImpl, OPENROUTER_URL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
			"x-title": "Evidence Library release notes",
		},
		body: JSON.stringify({
			model: MODEL,
			reasoning: { effort: "max" },
			instructions: INSTRUCTIONS,
			input,
			text: {
				format: {
					type: "json_schema",
					name: "release_notes",
					strict: true,
					schema: OUTPUT_SCHEMA,
				},
			},
		}),
	});
	if (status !== 200 || !body) {
		throw new Error(`The model request failed with status ${status}: ${text.slice(0, 500)}`);
	}
	if (body.status !== "completed") {
		throw new Error(`The model answer is ${body.status ?? "missing"}`);
	}
	const answer = outputText(body);
	if (answer === null) throw new Error("The model answer has no text");
	return parseNotes(answer);
}

function capitalise(word) {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The release body. */
export function renderNotes({ summary, notes }) {
	if (notes.length === 0) return `${NOTHING_VISIBLE}\n`;
	const lines = notes.map((note) => `- ${capitalise(note.area)}: ${note.note}`);
	return `${summary || NOTHING_VISIBLE}\n\n${lines.join("\n")}\n`;
}

export async function generateReleaseNotes({
	commits,
	repository,
	githubToken,
	apiKey,
	fetchImpl = fetch,
}) {
	if (commits.length === 0) throw new Error("There are no commits to describe");
	const entries = await describeChanges({ commits, repository, githubToken, fetchImpl });
	const notes = await askModel({ input: buildInput(entries), apiKey, fetchImpl });
	return renderNotes(notes);
}

function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const commits = parseCommits(readFileSync(0, "utf8"));
	const body = await generateReleaseNotes({
		commits,
		repository: requireEnv("GITHUB_REPOSITORY"),
		githubToken: requireEnv("GITHUB_TOKEN"),
		apiKey: requireEnv("OPENROUTER_API_KEY"),
	});
	process.stdout.write(body);
}
