"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { PublishingChoice } from "@/lib/admin/review-contract";
import {
	getAdminCrossrefReservation,
	reserveAdminCrossrefDoi,
	getAdminPublishingChoice,
	saveAdminPublishingChoice,
} from "./admin-api";

/** The cache key of a record's saved DOI choice, shared with the editor, which reads it beside the record. */
export const publishingChoiceKey = (itemKey: string) => ["admin-publishing-choice", itemKey] as const;

export function usePublishingChoice(
	detail: Pick<AdminItemDetail, "key" | "kind">,
	readOnly: boolean,
	/** Runs once a change is saved, since it changes what publishing would do. */
	onSaved: () => void,
) {
	const saved = useSWR(
		!readOnly && detail.kind === "created"
			? publishingChoiceKey(detail.key)
			: null,
		([, key]) => getAdminPublishingChoice(key),
	);
	const reservation = useSWR(
		detail.kind === "created"
			? ["admin-crossref-reservation", detail.key]
			: null,
		([, key]) => getAdminCrossrefReservation(key),
	);
	const [saving, setSaving] = useState(false);
	const pending = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const run = async (request: () => Promise<unknown>, message: string) => {
		if (pending.current || readOnly) return;
		pending.current = true;
		setSaving(true);
		setError(null);
		try {
			await request();
			onSaved();
		} catch (error) {
			setError(error instanceof Error ? error.message : message);
		} finally {
			pending.current = false;
			setSaving(false);
		}
	};
	const save = (next: PublishingChoice | null) =>
		run(async () => {
			await saved.mutate(
				() => saveAdminPublishingChoice(detail.key, next),
				{
					optimisticData: (current) => ({
						choice: next,
						canClear: current?.canClear ?? true,
						lockedIdentifierPolicy: current?.lockedIdentifierPolicy ?? null,
					}),
					rollbackOnError: true,
					populateCache: true,
					revalidate: false,
				},
			);
		}, "Could not save identifier choice");
	const onReserve = () => {
		void run(async () => {
			const stored = await reserveAdminCrossrefDoi(detail.key);
			await reservation.mutate(stored, { revalidate: false });
		}, "Could not reserve DOI");
	};

	return { saved, reservation, saving, error, save, onReserve };
}
