import { setTimeout as delay } from "node:timers/promises";

import type { SourceStatus } from "./source-status";

const SOURCE_STATUS_PATH = "/api/v1/evidence-libraries/source-status";
/** How often status goes out while a source imports or updates search, and otherwise. */
const ACTIVE_REPORT_MS = 5_000;
const IDLE_REPORT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
// A raw error can be 32 KiB; OpenScholar only shows it folded away.
const MAX_FAILURE_DETAILS = 4_096;

type ReporterOptions = {
	convexSiteUrl: string;
	libraryId: string;
	machineCredential: string;
	read: () => Promise<SourceStatus[]>;
	fetch?: typeof fetch;
	now?: () => Date;
	log?: (message: string) => void;
};

function trimFailure(status: SourceStatus): SourceStatus {
	if (status.state !== "failed") return status;
	return {
		...status,
		failure: { ...status.failure, details: status.failure.details.slice(0, MAX_FAILURE_DETAILS) },
	};
}

/**
 * Sends the library's source status to OpenScholar when it changed. A failed
 * post is not remembered as sent, so the next call tries again.
 */
export function createSourceStatusReporter(options: ReporterOptions) {
	const request = options.fetch ?? fetch;
	const now = options.now ?? (() => new Date());
	const log = options.log ?? console.error;
	const url = new URL(SOURCE_STATUS_PATH, options.convexSiteUrl);
	let sent: string | null = null;
	let lastProblem: string | null = null;

	return async function report(): Promise<{ active: boolean }> {
		const sources = (await options.read()).map(trimFailure);
		const active = sources.some((source) => source.state === "running");
		const snapshot = JSON.stringify(sources);
		if (snapshot === sent) return { active };
		try {
			const response = await request(url, {
				body: JSON.stringify({
					libraryId: options.libraryId,
					observedAt: now().toISOString(),
					sources,
					version: 1,
				}),
				headers: {
					Authorization: `Bearer ${options.machineCredential}`,
					"Content-Type": "application/json",
				},
				method: "POST",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) {
				const body = (await response.text().catch(() => "")).slice(0, 500);
				throw new Error(`OpenScholar answered ${response.status}${body ? `: ${body}` : ""}`);
			}
			sent = snapshot;
			lastProblem = null;
		} catch (error) {
			const problem = error instanceof Error ? error.message : String(error);
			// One line per distinct failure, not one every few seconds.
			if (problem !== lastProblem) log(`Source status report to ${url.href} failed: ${problem}`);
			lastProblem = problem;
		}
		return { active };
	};
}

/** Reports until the signal aborts: often while work runs, rarely when idle. */
export async function runSourceStatusReporter(
	report: () => Promise<{ active: boolean }>,
	signal: AbortSignal,
	onError: (error: unknown) => void,
) {
	while (!signal.aborted) {
		let active = false;
		try {
			({ active } = await report());
		} catch (error) {
			onError(error);
		}
		try {
			await delay(active ? ACTIVE_REPORT_MS : IDLE_REPORT_MS, undefined, { signal });
		} catch {
			return;
		}
	}
}
