"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { updateAdminReview, type AdminReviewSnapshot } from "./admin-api";

export function useReviewCorrections(snapshot: AdminReviewSnapshot | undefined, refresh: () => Promise<unknown>) {
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
 if (snapshot && !pending.current.size && !saving) {
  const incoming = `${snapshot.reviewId}:${snapshot.reviewRevision}`;
  if (incoming !== loadedRevision && (!current.current || snapshot.reviewId !== current.current.reviewId || snapshot.reviewRevision >= current.current.reviewRevision)) {
   current.current = snapshot;
   setLoadedRevision(incoming);
   setPayloads({});
  }
 }

 const flush = () => {
  clearTimeout(timer.current);
  const next = queue.current.then(async () => {
   const review = current.current;
   if (!review || !pending.current.size) return;
   const edits = new Map(pending.current);
   pending.current.clear();
   try {
    const records = [review, ...review.frozenAttachments];
    const saved = await updateAdminReview(review.reviewId, {
     action: "correct", expectedRevision: review.reviewRevision,
     records: [...edits].map(([itemKey, payload]) => {
      const record = records.find(record => record.key === itemKey);
      if (!record?.draft) throw new Error("The submitted item is no longer available.");
      return {itemKey, baseRevision: record.draft.baseRevision, payload};
     }),
    });
    current.current = {...review, reviewRevision: saved.revision};
    await refreshRef.current();
    setError(null);
   } catch (error) {
    for (const [key, payload] of edits) if (!pending.current.has(key)) pending.current.set(key, payload);
    const message = error instanceof Error ? error.message : "Could not save review corrections";
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
  payloads, saving: saving || Boolean(snapshot && current.current && snapshot.reviewId === current.current.reviewId && snapshot.reviewRevision < current.current.reviewRevision), error,
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
