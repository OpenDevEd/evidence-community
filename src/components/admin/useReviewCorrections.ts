"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateAdminReview, type AdminReviewSnapshot } from "./admin-api";

type CorrectionRecord = Pick<AdminReviewSnapshot, "key"> & {draft: {baseRevision: number} | null};
type CorrectionSnapshot = Pick<AdminReviewSnapshot, "reviewId" | "reviewRevision"> & CorrectionRecord & {frozenAttachments: CorrectionRecord[]};

function correctionRecords(review: CorrectionSnapshot, edits: Map<string, Record<string, unknown>>) {
 const records = [review, ...review.frozenAttachments];
 return [...edits].map(([itemKey, payload]) => {
  const record = records.find(record => record.key === itemKey);
  if (!record?.draft) throw new Error("The submitted item is no longer available.");
  return {itemKey, baseRevision: record.draft.baseRevision, payload};
 });
}

function restorePendingEdits(pending: Map<string, Record<string, unknown>>, edits: Map<string, Record<string, unknown>>) {
 for (const [key, payload] of edits) if (!pending.has(key)) pending.set(key, payload);
}

function mayReplaceSnapshot(incoming: CorrectionSnapshot, current: CorrectionSnapshot | undefined) {
 return !current || incoming.reviewId !== current.reviewId || incoming.reviewRevision >= current.reviewRevision;
}

function awaitingSnapshot(snapshot: CorrectionSnapshot | undefined, current: CorrectionSnapshot | undefined) {
 if (!snapshot || !current) return false;
 return snapshot.reviewId === current.reviewId && snapshot.reviewRevision < current.reviewRevision;
}

function correctionError(error: unknown) {
 return error instanceof Error ? error.message : "Could not save review corrections";
}

export function useReviewCorrections(snapshot: CorrectionSnapshot | undefined, refresh: () => Promise<unknown>) {
 const [loadedRevision, setLoadedRevision] = useState<string | undefined>(undefined);
 const [payloads, setPayloads] = useState<Record<string, Record<string, unknown>>>({});
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const pending = useRef(new Map<string, Record<string, unknown>>());
 const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const queue = useRef(Promise.resolve());
 const current = useRef(snapshot);
 const refreshRef = useRef(refresh);
 refreshRef.current = refresh;
 const incoming = snapshot ? `${snapshot.reviewId}:${snapshot.reviewRevision}` : undefined;
 const canLoad = snapshot && mayReplaceSnapshot(snapshot, current.current);
 if (canLoad && incoming !== loadedRevision && !(pending.current.size || saving)) {
  current.current = snapshot;
  setLoadedRevision(incoming);
  setPayloads({});
 }

 const flush = () => {
  clearTimeout(timer.current);
  const next = queue.current.then(async () => {
   const review = current.current;
   if (!review || !pending.current.size) return;
   const edits = new Map(pending.current);
   pending.current.clear();
   try {
    const saved = await updateAdminReview(review.reviewId, {
     action: "correct", expectedRevision: review.reviewRevision,
     records: correctionRecords(review, edits),
    });
    current.current = {...review, reviewRevision: saved.revision};
    await refreshRef.current();
    setError(null);
   } catch (error) {
    restorePendingEdits(pending.current, edits);
    const message = correctionError(error);
    setError(message);
    toast.error(message);
   } finally { setSaving(pending.current.size > 0); }
  });
  queue.current = next;
  return next;
 };
 const flushRef = useRef(flush);
 flushRef.current = flush;
 useEffect(() => () => { void flushRef.current(); }, []);

 return {
  payloads, saving: saving || awaitingSnapshot(snapshot, current.current), error,
  change: (key: string, payload: Record<string, unknown>) => {
   setPayloads(previous => ({...previous, [key]: payload}));
   pending.current.set(key, payload);
   setSaving(true);
   setError(null);
   clearTimeout(timer.current);
   timer.current = setTimeout(() => { void flushRef.current(); }, 700);
  },
 };
}
