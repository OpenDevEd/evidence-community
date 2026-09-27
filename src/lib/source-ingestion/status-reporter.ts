import { setTimeout as delay } from "node:timers/promises";

import type { SourceStatus } from "./source-status";

const SOURCE_STATUS_PATH = "/api/v1/evidence-libraries/source-status";
/** How often the worker checks for work, and the longest it goes without a report. */
const ACTIVITY_CHECK_MS = 5_000;
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

	/** Resolves true once OpenScholar has this status, false when the post failed. */
	return async function report(): Promise<boolean> {
		// Timed before the read, so a slow read cannot pass for a newer one.
		const observedAt = now().toISOString();
		const sources = (await options.read()).map(trimFailure);
		const snapshot = JSON.stringify(sources);
		if (snapshot === sent) {
			lastProblem = null;
			return true;
		}
		try {
			const response = await request(url, {
				body: JSON.stringify({
					libraryId: options.libraryId,
					observedAt,
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
			return true;
		} catch (error) {
			const problem = error instanceof Error ? error.message : String(error);
			// One line per distinct failure, not one every few seconds.
			if (problem !== lastProblem) log(`Source status report to ${url.href} failed: ${problem}`);
			lastProblem = problem;
			return false;
		}
	};
}

/**
 * Reports until the signal aborts: every few seconds while a source imports
 * or its search update runs, and at least once a minute otherwise.
 */
export async function runSourceStatusReporter(options: {
	report: () => Promise<boolean>;
	/** A cheap check for work under way, run every few seconds. */
	isActive: () => Promise<boolean>;
	onError: (error: unknown) => void;
	signal: AbortSignal;
	now?: () => number;
	wait?: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
}) {
	const now = options.now ?? Date.now;
	const wait = options.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
	let lastReport = Number.NEGATIVE_INFINITY;
	// Owed from the moment work is seen until a report after it goes through,
	// so the end of the work shows at once even when a post failed on the way.
	let owed = false;
	while (!options.signal.aborted) {
		try {
			const active = await options.isActive();
			if (active) owed = true;
			const due = owed || now() - lastReport >= IDLE_REPORT_MS;
			const checkedAt = now();
			// A failed post stays due, so the next check tries again.
			if (due && (await options.report())) {
				lastReport = checkedAt;
				owed = active;
			}
		} catch (error) {
			options.onError(error);
		}
		await wait(ACTIVITY_CHECK_MS, options.signal).catch(() => undefined);
	}
}
