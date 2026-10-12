-- Rollback for 0085_record-reading. The runtime before it has no reading, so rolling the release back needs only
-- this. Dropping the tables loses every record's study type and grades, and the spend so far; they are read again,
-- and paid for again, after the release returns.
DROP TRIGGER enqueue_item_reading ON "outbox";--> statement-breakpoint
DROP TRIGGER enqueue_item_reading_for_link ON "itemSourceLink";--> statement-breakpoint
DROP FUNCTION enqueue_item_reading_for_link();--> statement-breakpoint
DROP FUNCTION enqueue_item_reading();--> statement-breakpoint
DROP TABLE "itemReadingQueue";--> statement-breakpoint
DROP TABLE "itemGrade";--> statement-breakpoint
DROP TABLE "itemReading";--> statement-breakpoint
DROP TABLE "readingSpend";
