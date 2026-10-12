-- A source's subject is written when the workers next store its screening, which they do when they start with this
-- release; until then a row holds an empty subject.
ALTER TABLE "sourceScreening" ADD COLUMN "subject" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "sourceScreening" ALTER COLUMN "subject" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "itemGrade_latest_idx" ON "itemGrade" USING btree ("sourceConnectionKey","grade","gradedAt");
