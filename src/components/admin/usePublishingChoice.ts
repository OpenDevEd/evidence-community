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

export function usePublishingChoice(
	detail: Pick<AdminItemDetail, "key" | "kind">,
	readOnly: boolean,
) {
	const saved = useSWR(
		!readOnly && detail.kind === "created"
			? ["admin-publishing-choice", detail.key]
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
