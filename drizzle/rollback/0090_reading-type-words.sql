-- Rollback for 0090_reading-type-words. The word checks are lost; the earlier code shows every call as its confidence
-- alone says. Records the migration queued finish with nothing to read.
ALTER TABLE "itemReading" DROP COLUMN "typeWords";
