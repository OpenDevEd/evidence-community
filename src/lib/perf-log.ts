type PerfFields = Record<string, unknown>;

function nowMs() {
	return Number(process.hrtime.bigint()) / 1_000_000;
}

function roundMs(value: number) {
	return Math.round(value * 100) / 100;
}

function normalizeValue(value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}

	if (Array.isArray(value)) {
		return value.map(normalizeValue);
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	return Object.fromEntries(
		Object.entries(value).map(([key, nestedValue]) => [
			key,
			normalizeValue(nestedValue),
		]),
	);
}

function logPerf(level: "info" | "error", payload: PerfFields) {
	const normalizedPayload = normalizeValue(payload);
	const serializedPayload =
		typeof normalizedPayload === "string"
			? normalizedPayload
			: JSON.stringify(normalizedPayload);

	console[level](`[item-perf] ${serializedPayload}`);
}

export function createPerfTrace(scope: string, fields: PerfFields = {}) {
	const startedAtMs = nowMs();
	const traceId =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

	const baseFields = {
		scope,
		traceId,
		...fields,
	};

	return {
		step(step: string, extra: PerfFields = {}) {
			logPerf("info", {
				...baseFields,
				step,
				elapsedMs: roundMs(nowMs() - startedAtMs),
				...extra,
			});
		},
		end(extra: PerfFields = {}) {
			logPerf("info", {
				...baseFields,
				step: "complete",
				totalMs: roundMs(nowMs() - startedAtMs),
				...extra,
			});
		},
		error(step: string, error: unknown, extra: PerfFields = {}) {
			logPerf("error", {
				...baseFields,
				step,
				elapsedMs: roundMs(nowMs() - startedAtMs),
				error,
				...extra,
			});
		},
	};
}

export function getApproxJsonBytes(value: unknown) {
	try {
		return JSON.stringify(value).length;
	} catch {
		return null;
	}
}
