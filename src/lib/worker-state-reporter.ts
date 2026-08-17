export type WorkerStateReporter<TProgress> = {
	current: () => TProgress;
	flush: () => Promise<void>;
	report: (progress: TProgress, force?: boolean) => Promise<void>;
};

export function createWorkerStateReporter<TProgress>(options: {
	initialProgress: TProgress;
	minimumWriteIntervalMs?: number;
	now?: () => Date;
	write: (progress: TProgress, heartbeatAt: Date) => Promise<unknown>;
}): WorkerStateReporter<TProgress> {
	const minimumWriteIntervalMs = options.minimumWriteIntervalMs ?? 1_000;
	if (
		!Number.isSafeInteger(minimumWriteIntervalMs) ||
		minimumWriteIntervalMs < 0
	) {
		throw new Error("minimumWriteIntervalMs must be a nonnegative integer");
	}
	const currentTime = options.now ?? (() => new Date());
	let progress = options.initialProgress;
	let lastWriteAt = 0;
	let queue = Promise.resolve();

	return {
		current: () => progress,
		flush: () => queue,
		report: (nextProgress, force = false) => {
			progress = nextProgress;
			const heartbeatAt = currentTime();
			if (
				!force &&
				heartbeatAt.getTime() - lastWriteAt < minimumWriteIntervalMs
			) {
				return queue;
			}
			lastWriteAt = heartbeatAt.getTime();
			const operation = queue
				.catch(() => undefined)
				.then(() => options.write(nextProgress, heartbeatAt));
			queue = operation.then(
				() => undefined,
				() => undefined,
			);
			return operation.then(() => undefined);
		},
	};
}
