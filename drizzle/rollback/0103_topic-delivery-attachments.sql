-- Rollback for 0103_topic-delivery-attachments. Keep the trigger function: an older runtime only resends a record
-- without its PDF when an attachment changes, which changes no data. But a delivery waiting with a payload built by
-- this release carries `metadata.pdf`, which an older worker's contract refuses, so it would retry it forever: those are
-- rebuilt, as a new generation, by the older worker.
UPDATE "topicAssociationDelivery" SET "generation" = "generation" + 1, "payload" = NULL, "attempts" = 0,
  "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
WHERE "payload" -> 'metadata' ? 'pdf';
