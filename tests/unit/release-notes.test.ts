import { describe, expect, it, vi } from "vitest";

import {
	MODEL,
	NOTHING_VISIBLE,
	generateReleaseNotes,
	parseCommits,
	parseNotes,
	pullRequestNumber,
	renderNotes,
} from "../../.github/scripts/release-notes.mjs";

const SQUASH = "a".repeat(40);
const MERGE = "b".repeat(40);
const DIRECT = "c".repeat(40);
const LOG = [
	`${SQUASH}Dismiss source import issues (#183)Dismiss source import issues\n`,
	`${MERGE}Merge pull request #179 from OpenDevEd/codex/fix\n`,
	`${DIRECT}fix: log runtime configuration failuresThe log line names the revision.\n`,
]
	.map((record) => `${record}\n`)
	.join("");

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function modelAnswer(answer: unknown, status = "completed"): Response {
	return jsonResponse({
		status,
		output: [
			{
				type: "message",
				content: [{ type: "output_text", text: JSON.stringify(answer) }],
			},
		],
	});
}

describe("runtime release notes", () => {
	it("reads one record per commit and finds the pull request in the subject", () => {
		const commits = parseCommits(LOG);
		expect(commits.map((commit: { sha: string }) => commit.sha)).toEqual([
			SQUASH,
			MERGE,
			DIRECT,
		]);
		expect(commits[2]).toEqual({
			sha: DIRECT,
			subject: "fix: log runtime configuration failures",
			body: "The log line names the revision.",
		});
		expect(pullRequestNumber(commits[0].subject)).toBe(183);
		expect(pullRequestNumber(commits[1].subject)).toBe(179);
		expect(pullRequestNumber(commits[2].subject)).toBeNull();
	});

	it("describes changes with their pull request text and asks the model in strict JSON", async () => {
		const modelRequests: Array<Record<string, unknown>> = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "https://api.github.com/repos/OpenDevEd/new-el/pulls/183") {
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gh-token");
				return jsonResponse({
					title: "Dismiss source import issues and page the issue list",
					body: "## Change\n\n- An import issue behaves like a notification.",
				});
			}
			if (url === "https://api.github.com/repos/OpenDevEd/new-el/pulls/179") {
				return jsonResponse({ message: "Not Found" }, 404);
			}
			if (url === "https://openrouter.ai/api/v1/responses") {
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer router-key");
				modelRequests.push(JSON.parse(String(init?.body)));
				return modelAnswer({
					summary: "Import problems are easier to manage.",
					notes: [
						{ area: "sources", note: "Import issues can be dismissed and restored." },
						{ area: "reliability", note: "  " },
					],
				});
			}
			throw new Error(`Unexpected request ${url}`);
		}) as unknown as typeof fetch;

		const body = await generateReleaseNotes({
			commits: parseCommits(LOG),
			repository: "OpenDevEd/new-el",
			githubToken: "gh-token",
			apiKey: "router-key",
			fetchImpl,
		});

		expect(body).toBe(
			"Import problems are easier to manage.\n\n- Sources: Import issues can be dismissed and restored.\n",
		);
		expect(modelRequests).toHaveLength(1);
		const request = modelRequests[0];
		expect(request.model).toBe(MODEL);
		expect(request.reasoning).toEqual({ effort: "max" });
		expect(request.text).toMatchObject({
			format: { type: "json_schema", name: "release_notes", strict: true },
		});
		expect(request.input).toBe(
			[
				"### 1. Dismiss source import issues and page the issue list",
				"## Change",
				"",
				"- An import issue behaves like a notification.",
				"",
				"### 2. Merge pull request #179 from OpenDevEd/codex/fix",
				"",
				"### 3. fix: log runtime configuration failures",
				"The log line names the revision.",
			].join("\n"),
		);
	});

	it("names only maintenance when nothing is visible", () => {
		expect(renderNotes({ summary: "Internal work.", notes: [] })).toBe(`${NOTHING_VISIBLE}\n`);
	});

	it("rejects an answer outside the agreed shape", () => {
		expect(() => parseNotes("not json")).toThrow("did not return JSON");
		expect(() => parseNotes(JSON.stringify({ summary: "x" }))).toThrow("not a release note");
		expect(() =>
			parseNotes(JSON.stringify({ summary: "x", notes: [{ area: "kernel", note: "y" }] })),
		).toThrow("without an area");
	});

	it("fails instead of publishing a cut-off answer", async () => {
		const fetchImpl = vi.fn(async () =>
			modelAnswer({ summary: "", notes: [] }, "incomplete"),
		) as unknown as typeof fetch;
		await expect(
			generateReleaseNotes({
				commits: parseCommits(`${DIRECT}fix: x\n`),
				repository: "OpenDevEd/new-el",
				githubToken: "gh-token",
				apiKey: "router-key",
				fetchImpl,
			}),
		).rejects.toThrow("The model answer is incomplete");
	});
});
