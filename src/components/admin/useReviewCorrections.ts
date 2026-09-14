"use client";

import {
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	adminErrorMessage,
	updateAdminReview,
	type AdminReviewSnapshot,
} from "./admin-api";

type CorrectionRecord = Pick<AdminReviewSnapshot, "key"> & {
	draft: { baseRevision: number; payload: Record<string, unknown> } | null;
};
type CorrectionSnapshot = Pick<
	AdminReviewSnapshot,
	"reviewId" | "reviewRevision"
> &
	CorrectionRecord & { frozenAttachments: CorrectionRecord[] };

function correctionRecords(
	review: CorrectionSnapshot,
	edits: Map<string, Record<string, unknown>>,
) {
	const records = [review, ...review.frozenAttachments];
	return [...edits].map(([itemKey, payload]) => {
		const record = records.find((record) => record.key === itemKey);
		if (!record?.draft)
			throw new Error("The submitted item is no longer available.");
		return { itemKey, baseRevision: record.draft.baseRevision, payload };
	});
}

function restorePendingEdits(
	pending: Map<string, Record<string, unknown>>,
	edits: Map<string, Record<string, unknown>>,
) {
	for (const [key, payload] of edits)
		if (!pending.has(key)) pending.set(key, payload);
}

function awaitingSnapshot(
	snapshot: CorrectionSnapshot | undefined,
	current: CorrectionSnapshot | undefined,
) {
	if (!snapshot || !current) return false;
	return (
		snapshot.reviewId === current.reviewId &&
		snapshot.reviewRevision < current.reviewRevision
	);
}

function revisionKey(snapshot: CorrectionSnapshot | undefined) {
	return snapshot
		? `${snapshot.reviewId}:${snapshot.reviewRevision}`
		: undefined;
}

function shouldLoadSnapshot(
	snapshot: CorrectionSnapshot | undefined,
	current: CorrectionSnapshot | undefined,
	loadedRevision: string | undefined,
	pendingCount: number,
	saving: boolean,
) {
	if (!snapshot || pendingCount > 0 || saving) return false;
	return (
		revisionKey(snapshot) !== loadedRevision &&
		!awaitingSnapshot(snapshot, current)
	);
}

function acknowledgeCorrections(
	review: CorrectionSnapshot,
	edits: Map<string, Record<string, unknown>>,
	revision: number,
): CorrectionSnapshot {
	const savedRecord = (record: CorrectionRecord) => {
		const payload = edits.get(record.key);
		return payload && record.draft
			? { ...record, draft: { ...record.draft, payload } }
			: record;
	};
	return {
		...review,
		...savedRecord(review),
		frozenAttachments: review.frozenAttachments.map(savedRecord),
		reviewRevision: revision,
	};
}

function resolveCorrectionPayload(
	review: CorrectionSnapshot | undefined,
	pending: Map<string, Record<string, unknown>>,
	inFlight: Map<string, Record<string, unknown>>,
	key: string,
	update: SetStateAction<Record<string, unknown>>,
) {
	const record =
		review &&
		[review, ...review.frozenAttachments].find(
			(entry) => entry.key === key,
		);
	const previous =
		pending.get(key) ?? inFlight.get(key) ?? record?.draft?.payload;
	if (typeof update !== "function") return update;
	if (!previous)
		throw new Error("The submitted item is no longer available.");
	return update(previous);
}

export function useReviewCorrections(
	snapshot: CorrectionSnapshot | undefined,
	refresh: () => Promise<unknown>,
) {
	const [loadedRevision, setLoadedRevision] = useState<string | undefined>(
		undefined,
	);
	const [payloads, setPayloads] = useState<
		Record<string, Record<string, unknown>>
	>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inFlight = useRef(new Map<string, Record<string, unknown>>());
	const pending = useRef(new Map<string, Record<string, unknown>>());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const queue = useRef(Promise.resolve());
	const current = useRef(snapshot);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	if (
		shouldLoadSnapshot(
			snapshot,
			current.current,
			loadedRevision,
			pending.current.size,
			saving,
		)
	) {
		current.current = snapshot;
		setLoadedRevision(revisionKey(snapshot));
		setPayloads({});
	}

	const savePending = async () => {
		const review = current.current;
		if (!review || !pending.current.size) return;
		const edits = new Map(pending.current);
		inFlight.current = edits;
		pending.current.clear();
		try {
			const saved = await updateAdminReview(review.reviewId, {
				action: "correct",
				expectedRevision: review.reviewRevision,
				records: correctionRecords(review, edits),
			});
			current.current = acknowledgeCorrections(
				review,
				edits,
				saved.revision,
			);
			await refreshRef.current();
			setError(null);
		} catch (error) {
			restorePendingEdits(pending.current, edits);
			const message = adminErrorMessage(
				error,
				"Could not save review corrections",
			);
			setError(message);
			toast.error(message);
		} finally {
			inFlight.current = new Map();
			setSaving(pending.current.size > 0);
		}
	};
	const flush = () => {
		clearTimeout(timer.current);
		queue.current = queue.current.then(savePending);
		return queue.current;
	};
	const flushRef = useRef(flush);
	flushRef.current = flush;
	useEffect(
		() => () => {
			void flushRef.current();
		},
		[],
	);

	const change = useCallback(
		(key: string, update: SetStateAction<Record<string, unknown>>) => {
			const payload = resolveCorrectionPayload(
				current.current,
				pending.current,
				inFlight.current,
				key,
				update,
			);
			setPayloads((previous) => ({ ...previous, [key]: payload }));
			pending.current.set(key, payload);
			setSaving(true);
			setError(null);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				void flushRef.current();
			}, 700);
		},
		[],
	);

	return {
		payloads,
		saving: saving || awaitingSnapshot(snapshot, current.current),
		error,
		change,
	};
}
